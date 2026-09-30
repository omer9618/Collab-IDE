/**
 * @file routes/voice.js
 * @module routes/voice
 * @description Voice Chat REST Endpoints (FR-53, NFR-25, NFR-30).
 * 
 * Provides:
 * - Time-limited, user-specific HMAC-SHA1 TURN/STUN credentials generation (NFR-30)
 * - Immediate voice channel participant hydration for newly joined clients
 * 
 * SECURITY REASONING:
 * - TURN Relay Abuse Prevention (NFR-30): Coturn REST API credentials use an ephemeral
 *   HMAC-SHA1 digest with a 1-hour TTL. Unauthorized external actors cannot piggyback on the
 *   TURN server for arbitrary bandwidth relaying.
 * - Membership Authorization (NFR-25): Both endpoints require the caller to be an active,
 *   enrolled participant in `room.participants`.
 */

const express = require('express');
const crypto  = require('crypto');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const Room = require('../models/Room');
const { voiceRooms } = require('../socket/voice');
const logger = require('../utils/logger');

const router = express.Router({ mergeParams: true });

// ─── GET /api/voice/:uuid/credentials ─────────────────────────────────────────

/**
 * @route   GET /api/voice/:uuid/credentials
 * @desc    Issue time-limited TURN/STUN credentials for WebRTC peer connection (NFR-30).
 * @access  Private (Room members only)
 * 
 * SECURITY REASONING & CREDENTIAL ARCHITECTURE:
 * 1. Time-Limited Ephemeral Credentials (NFR-30): Generates a username in `<expiryTimestamp>:<userId>`
 *    format and an HMAC-SHA1 signature using `TURN_SECRET`. The credential expires automatically
 *    after 3600 seconds (1 hour), eliminating persistent credential exposure.
 * 2. Bandwidth & NAT Traversal Protection: Prevents unauthenticated third parties from abusing
 *    relay bandwidth while providing symmetric NAT traversal for firewall-restricted users.
 * 3. Room Membership Verification (NFR-25): Calls must originate from a verified member.
 */
router.get('/:uuid/credentials', protect, apiLimiter, async (req, res) => {
  try {
    const { uuid } = req.params;

    // Security: Verify room membership before issuing expensive relay credentials (NFR-25)
    const room = await Room.findOne({ uuid }, 'participants');
    if (!room) return res.status(404).json({ message: 'Room not found.' });

    const isMember = room.participants.some(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });
    if (!isMember) return res.status(403).json({ message: 'Access denied.' });

    // ── HMAC-SHA1 TURN credentials (NFR-30, coturn REST API spec) ─────────────
    // username format: <expiryTimestamp>:<userId>
    // credential:      base64(HMAC-SHA1(TURN_SECRET, username))
    const turnSecret  = process.env.TURN_SECRET;
    const expiresAt   = Math.floor(Date.now() / 1000) + 3600; // 1 hour TTL from current time
    const turnUsername = `${expiresAt}:${req.user._id}`;
    const turnCredential = crypto
      .createHmac('sha1', turnSecret)
      .update(turnUsername)
      .digest('base64');

    // ── Build RTCConfiguration iceServers array ────────────────────────────────
    const iceServers = [
      // Google public STUN (no auth needed)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },

      // Open Relay TURN — free development/demo relay (FR-53)
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turns:openrelay.metered.ca:443?transport=tcp',
        ],
        username:   'openrelayproject',
        credential: 'openrelayproject',
      },

      // Production coturn server integration:
      // Uses time-limited HMAC credentials generated above (NFR-30)
      ...(process.env.TURN_SERVER_URL ? [{
        urls:       process.env.TURN_SERVER_URL,
        username:   turnUsername,
        credential: turnCredential,
      }] : []),
    ];

    return res.status(200).json({
      iceServers,
      // Expose credential metadata for client-side expiry tracking (NFR-30)
      credentials: {
        username:   turnUsername,
        credential: turnCredential,
        expiresAt,
      },
    });
  } catch (err) {
    logger.error('Error generating TURN credentials: ' + err.message, { userId: req.user?._id, roomId: req.params?.uuid });
    return res.status(500).json({ message: 'Failed to generate credentials.' });
  }
});

// ─── GET /api/voice/:uuid/participants ────────────────────────────────────────

/**
 * @route   GET /api/voice/:uuid/participants
 * @desc    Return current live voice participants and channel settings for a room.
 * @access  Private (Room members only)
 * 
 * SECURITY REASONING:
 * Provides immediate REST-based hydration for joining peers to render participant
 * cards before WebRTC offers arrive, guarded by membership check (NFR-25).
 */
router.get('/:uuid/participants', protect, apiLimiter, async (req, res) => {
  try {
    const { uuid } = req.params;

    // Security: Validate room membership
    const room = await Room.findOne({ uuid }, 'participants');
    if (!room) return res.status(404).json({ message: 'Room not found.' });

    const isMember = room.participants.some(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });
    if (!isMember) return res.status(403).json({ message: 'Access denied.' });

    const voiceRoom = voiceRooms.get(uuid);
    const participants = voiceRoom
      ? Array.from(voiceRoom.participants.values()).map(p => ({
          userId:      p.userId,
          displayName: p.displayName,
          avatarColor: p.avatarColor,
          role:        p.role,
          isMuted:     p.isMuted,
          isHardMuted: p.isHardMuted,
          joinedAt:    p.joinedAt,
        }))
      : [];

    return res.status(200).json({
      participants,
      editorOnlyMode: voiceRoom?.editorOnlyMode || false,
    });
  } catch (err) {
    logger.error('Error fetching voice participants: ' + err.message, { userId: req.user?._id, roomId: req.params?.uuid });
    return res.status(500).json({ message: 'Failed to fetch participants.' });
  }
});

module.exports = router;
