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
const { sendPlainEnglishError } = require('../middleware/errorHandler');
const Room = require('../models/Room');
const { voiceRooms } = require('../socket/voice');
const logger = require('../utils/logger');

const router = express.Router({ mergeParams: true });

/**
 * Generates ephemeral HMAC-SHA1 TURN credentials with expiry timestamp (NFR-30).
 *
 * @function generateTurnCredentials
 * @param {string} userId - User ID
 * @param {string} [turnSecret=process.env.TURN_SECRET] - Secret key for HMAC
 * @param {number} [ttlSeconds=3600] - Credential lifetime in seconds
 * @returns {{ turnUsername: string, turnCredential: string, expiresAt: number }}
 */
function generateTurnCredentials(userId, turnSecret = process.env.TURN_SECRET, ttlSeconds = 3600) {
  if (!turnSecret || typeof turnSecret !== 'string' || turnSecret.trim() === '') {
    throw new Error('Fatal Configuration Error: TURN_SECRET environment variable is required (NFR-30, NFR-49).');
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const turnUsername = `${expiresAt}:${userId}`;
  const turnCredential = crypto
    .createHmac('sha1', turnSecret)
    .update(turnUsername)
    .digest('base64');
  return { turnUsername, turnCredential, expiresAt };
}

/**
 * Builds standard WebRTC ICE servers configuration including STUN and TURN relays (FR-53, NFR-30).
 *
 * @function buildIceServers
 * @param {string} turnUsername - Authenticated TURN username
 * @param {string} turnCredential - Authenticated TURN credential password
 * @param {string} [turnServerUrl=process.env.TURN_SERVER_URL] - Optional custom TURN URL
 * @param {string|string[]} [stunServerUrl=process.env.STUN_SERVER_URL] - Optional custom STUN URL
 * @returns {Array<{ urls: string|string[], username?: string, credential?: string }>}
 */
function buildIceServers(turnUsername, turnCredential, turnServerUrl = process.env.TURN_SERVER_URL, stunServerUrl = process.env.STUN_SERVER_URL) {
  const stunUrls = stunServerUrl
    ? (Array.isArray(stunServerUrl) ? stunServerUrl : [stunServerUrl])
    : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

  return [
    // Configured or public STUN servers
    { urls: stunUrls },

    // Open Relay TURN — free development/demo relay (FR-53)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },

    // Production coturn server integration:
    ...(turnServerUrl ? [{
      urls: turnServerUrl,
      username: turnUsername,
      credential: turnCredential,
    }] : []),
  ];
}

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
    if (!room) return res.status(404).json({ message: 'The specified room could not be found.' });

    const isMember = room.participants.some(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });
    if (!isMember) return res.status(403).json({ message: 'You do not have access to voice chat in this room.' });

    // ── HMAC-SHA1 TURN credentials (NFR-30, coturn REST API spec) ─────────────
    const { turnUsername, turnCredential, expiresAt } = generateTurnCredentials(req.user._id);
    const iceServers = buildIceServers(turnUsername, turnCredential);

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
    return sendPlainEnglishError(res, err, 'An error occurred while generating voice credentials. Please try again.');
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
    if (!room) return res.status(404).json({ message: 'The specified room could not be found.' });

    const isMember = room.participants.some(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });
    if (!isMember) return res.status(403).json({ message: 'You do not have access to voice chat in this room.' });

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
    return sendPlainEnglishError(res, err, 'An error occurred while fetching voice participants. Please try again.');
  }
});

router.generateTurnCredentials = generateTurnCredentials;
router.buildIceServers = buildIceServers;

module.exports = router;
module.exports.generateTurnCredentials = generateTurnCredentials;
module.exports.buildIceServers = buildIceServers;

