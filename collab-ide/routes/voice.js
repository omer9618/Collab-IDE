/**
 * routes/voice.js
 *
 * Voice Chat REST Endpoints — FR-53, NFR-30
 *
 * GET /api/voice/:uuid/credentials
 *   Returns ICE server config (STUN + TURN) with time-limited HMAC credentials.
 *   Credentials are generated per-user per-session and expire after 1 hour (NFR-30).
 *
 * GET /api/voice/:uuid/participants
 *   Returns the current live voice participant list for a room.
 *   Used by newly joining clients to hydrate the voice panel without waiting
 *   for a socket event.
 */

const express = require('express');
const crypto  = require('crypto');
const { protect } = require('../middleware/auth');
const Room = require('../models/Room');
const { voiceRooms } = require('../socket/voice');

const router = express.Router({ mergeParams: true });

// ─── GET /api/voice/:uuid/credentials ─────────────────────────────────────────

/**
 * @route  GET /api/voice/:uuid/credentials
 * @desc   Issue time-limited TURN credentials for this user/session (NFR-30).
 *         Returns an RTCConfiguration-compatible iceServers array.
 * @access Private — room members only
 */
router.get('/:uuid/credentials', protect, async (req, res) => {
  try {
    const { uuid } = req.params;

    // Verify room membership (NFR-25)
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
    const expiresAt   = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
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

      // Open Relay TURN — free, no signup, for development/demo (FR-53)
      // Credentials are their own open-access credentials, not HMAC-gated.
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turns:openrelay.metered.ca:443?transport=tcp',
        ],
        username:   'openrelayproject',
        credential: 'openrelayproject',
      },

      // Production TURN (coturn-compatible) — swap TURN_SERVER_URL in .env.
      // Uses time-limited HMAC credentials generated above (NFR-30).
      // Uncomment when deploying with a self-hosted or dedicated TURN server:
      // {
      //   urls:       process.env.TURN_SERVER_URL,
      //   username:   turnUsername,
      //   credential: turnCredential,
      // },
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
    console.error('❌ Error generating TURN credentials:', err.message);
    return res.status(500).json({ message: 'Failed to generate credentials.' });
  }
});

// ─── GET /api/voice/:uuid/participants ────────────────────────────────────────

/**
 * @route  GET /api/voice/:uuid/participants
 * @desc   Return current live voice participants for a room.
 *         Allows newly-joining clients to hydrate the voice panel immediately.
 * @access Private — room members only
 */
router.get('/:uuid/participants', protect, async (req, res) => {
  try {
    const { uuid } = req.params;

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
    console.error('❌ Error fetching voice participants:', err.message);
    return res.status(500).json({ message: 'Failed to fetch participants.' });
  }
});

module.exports = router;
