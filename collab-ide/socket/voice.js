/**
 * @file socket/voice.js
 * @module socket/voice
 * @description WebRTC Peer-to-Peer Voice Chat Signalling Module (FR-45 – FR-53, NFR-29 – NFR-31).
 * 
 * Attaches to the Socket.IO `/voice` namespace. Relays WebRTC SDP offers, answers,
 * and ICE candidates between browser peers in a mesh topology.
 * 
 * SECURITY REASONING & PRIVACY (NFR-31):
 * - Zero Audio on Server: The server functions purely as a metadata signalling relay.
 *   No audio bytes, media streams, or voice recordings ever pass through or are stored
 *   on the server, preserving end-to-end participant confidentiality and low latency.
 * - Authenticated Handshake: Every socket connection must present a valid RS256 JWT
 *   access token from a verified user before being accepted into the namespace.
 * - Strict In-Room Scoping: Signalling frames (SDP/ICE) are routed exclusively between
 *   clients confirmed to be co-present in the same room, preventing cross-room eavesdropping.
 * - Role-Based Voice Governance: Only room Owners and designated Room Leaders possess
 *   administrative authority to hard-mute participants or restrict channels to Editor-only mode.
 */

const jwt  = require('jsonwebtoken');
const { publicKey } = require('../utils/keys');
const User = require('../models/User');
const Room = require('../models/Room');

// ─── In-Memory Voice State ────────────────────────────────────────────────────

/**
 * In-memory registry of voice channel rooms.
 * Maps room UUID to its participant set and channel configuration flags.
 * Persists for the lifetime of the process.
 * 
 * @type {Map<string, {
 *   participants: Map<string, {
 *     userId: string,
 *     displayName: string,
 *     avatarColor: string,
 *     role: string,
 *     isMuted: boolean,
 *     isHardMuted: boolean,
 *     joinedAt: string,
 *     socketId: string
 *   }>,
 *   editorOnlyMode: boolean
 * }>}
 */
const voiceRooms = new Map();

/**
 * Retrieves an existing voice room state or initializes an empty one.
 *
 * @function getVoiceRoom
 * @param {string} roomUuid - Target room UUID
 * @returns {{ participants: Map<string, object>, editorOnlyMode: boolean }} Live voice room state
 */
function getVoiceRoom(roomUuid) {
  if (!voiceRooms.has(roomUuid)) {
    voiceRooms.set(roomUuid, {
      participants: new Map(),
      editorOnlyMode: false,
    });
  }
  return voiceRooms.get(roomUuid);
}

/**
 * Serializes a voice room's participant map into a safe array for broadcasting over Socket.IO.
 *
 * @function serializeParticipants
 * @param {{ participants: Map<string, object> }} voiceRoom - Voice room state object
 * @returns {Array<object>} Array of serialized participant objects
 */
function serializeParticipants(voiceRoom) {
  return Array.from(voiceRoom.participants.values()).map(p => ({
    userId:       p.userId,
    displayName:  p.displayName,
    avatarColor:  p.avatarColor,
    role:         p.role,
    isMuted:      p.isMuted,
    isHardMuted:  p.isHardMuted,
    joinedAt:     p.joinedAt,
    socketId:     p.socketId,
  }));
}

// ─── Role Helpers ──────────────────────────────────────────────────────────────

/**
 * Retrieves the current collaborative role for a socket connection in a voice room.
 *
 * @function getSocketRole
 * @param {{ participants: Map<string, object> }} voiceRoom - Target voice room state
 * @param {string} socketId - Socket identifier
 * @returns {string|null} Participant role ('Owner' | 'Room Leader' | 'Editor' | 'Viewer' | null)
 */
function getSocketRole(voiceRoom, socketId) {
  const p = voiceRoom.participants.get(socketId);
  return p?.role || null;
}

/**
 * Evaluates whether a collaborative role has administrative voice governance privileges.
 *
 * SECURITY REASONING:
 * Only Owners and Room Leaders are authorized to exercise administrative voice controls
 * (hard-muting individuals, muting all participants, or restricting the room to Editor-only).
 * Viewers and Editors cannot issue supervisory voice commands.
 *
 * @function isLeader
 * @param {string} role - Collaborative role to check
 * @returns {boolean} True if role has supervisory authority
 */
function isLeader(role) {
  return role === 'Owner' || role === 'Room Leader';
}

// ─── Signalling Initialiser ───────────────────────────────────────────────────

/**
 * Attaches all WebRTC voice signalling handlers to the `/voice` Socket.IO namespace.
 * Called once during application startup.
 *
 * @function initVoiceSignalling
 * @param {import('socket.io').Server} io - Root Socket.IO server instance
 */
function initVoiceSignalling(io) {
  const voiceNs = io.of('/voice');

  // ── Auth Middleware (NFR-17) ────────────────────────────────────────────────
  // Security: Authenticate the Socket.IO handshake before allowing any connection to establish
  voiceNs.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('AUTH_REQUIRED'));

      // Security: Validate RS256 signature against public key to prevent token tampering
      const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      const user = await User.findById(decoded.userId).select('-password');

      if (!user) return next(new Error('USER_NOT_FOUND'));
      // Security: Enforce email verification check for voice channel participants
      if (!user.isVerified) return next(new Error('UNVERIFIED'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('AUTH_FAILED'));
    }
  });

  // ── Connection Handler ──────────────────────────────────────────────────────
  voiceNs.on('connection', (socket) => {
    console.log(`🎙️  Voice socket connected: ${socket.user.displayName} (${socket.id})`);

    // Track active room on the socket session
    socket.roomUuid = null;

    // ── voice:join ─────────────────────────────────────────────────────── FR-45
    // Enrolls user into a voice room after verifying room membership and role eligibility
    socket.on('voice:join', async ({ roomUuid } = {}) => {
      try {
        if (!roomUuid) return socket.emit('voice:error', { message: 'roomUuid is required.' });

        // Security: Authoritative check verifying the user is a registered member of the room
        const room = await Room.findOne({ uuid: roomUuid }).populate('participants.user', 'displayName email');
        if (!room) return socket.emit('voice:error', { message: 'Room not found.' });

        const member = room.participants.find(p => {
          const pId = p.user._id ? p.user._id.toString() : p.user.toString();
          return pId === socket.user._id.toString();
        });
        if (!member) return socket.emit('voice:error', { message: 'You are not a member of this room.' });

        const voiceRoom = getVoiceRoom(roomUuid);

        // Security: FR-51 Editor-only mode enforcement
        // Blocks Viewers from joining the voice channel when editorOnlyMode is active
        if (voiceRoom.editorOnlyMode && member.role === 'Viewer') {
          return socket.emit('voice:error', {
            message: 'Voice is restricted to Editors only in this room. Ask the Room Leader to grant you Editor access first.',
          });
        }

        // Clean up previous room association if user switches rooms without disconnecting
        if (socket.roomUuid && socket.roomUuid !== roomUuid) {
          leaveVoiceRoom(socket, voiceNs);
        }

        socket.roomUuid = roomUuid;
        socket.join(roomUuid); // Join Socket.IO room channel

        // Clean up stale socket registrations for the same user (handles browser reloads/reconnects cleanly)
        const userId = socket.user._id.toString();
        for (const [existingSocketId, existingP] of voiceRoom.participants) {
          if (existingP.userId === userId && existingSocketId !== socket.id) {
            voiceRoom.participants.delete(existingSocketId);
            console.log(`🧹 Evicted stale voice entry for "${existingP.displayName}" (old socket: ${existingSocketId})`);
          }
        }

        const participant = {
          userId:      userId,
          displayName: socket.user.displayName,
          avatarColor: socket.user.avatarColor || '#89b4fa',
          role:        member.role,
          isMuted:     false,
          isHardMuted: false,
          joinedAt:    new Date().toISOString(),
          socketId:    socket.id,
        };

        voiceRoom.participants.set(socket.id, participant);

        console.log(`🎙️  [+] "${socket.user.displayName}" joined voice in room ${roomUuid} (${voiceRoom.participants.size} in voice)`);

        // Broadcast updated participant roster to all room members
        voiceNs.to(roomUuid).emit('voice:participant-joined', {
          joined: { ...participant, socketId: socket.id },
          participants: serializeParticipants(voiceRoom),
        });

      } catch (err) {
        console.error('❌ voice:join error:', err.message);
        socket.emit('voice:error', { message: 'Failed to join voice.' });
      }
    });

    // ── voice:leave ────────────────────────────────────────────────────── FR-46
    socket.on('voice:leave', () => {
      leaveVoiceRoom(socket, voiceNs);
    });

    // ── WebRTC Signalling Relay (FR-53) ────────────────────────────────────────
    // Relays SDP offers, answers, and ICE candidates strictly between verified peers.
    // SECURITY REASONING:
    // 1. Both the sender and target recipient must reside within the exact same room,
    //    preventing cross-room metadata injection or session snooping.
    // 2. The server functions as a dumb text pipe for SDP/ICE payloads, ensuring
    //    zero inspection or persistence of cryptographic session keys.

    // voice:offer — SDP offer relay
    socket.on('voice:offer', ({ to, sdp }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;
      // Security: Validate target socket is actively present in the same voice room
      if (!voiceRoom.participants.has(to)) return;

      voiceNs.to(to).emit('voice:offer', {
        from: socket.id,
        fromUserId: socket.user._id.toString(),
        sdp,
      });
    });

    // voice:answer — SDP answer relay
    socket.on('voice:answer', ({ to, sdp }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom || !voiceRoom.participants.has(to)) return;

      voiceNs.to(to).emit('voice:answer', {
        from: socket.id,
        fromUserId: socket.user._id.toString(),
        sdp,
      });
    });

    // voice:ice-candidate — ICE candidate relay
    socket.on('voice:ice-candidate', ({ to, candidate }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom || !voiceRoom.participants.has(to)) return;

      voiceNs.to(to).emit('voice:ice-candidate', {
        from: socket.id,
        fromUserId: socket.user._id.toString(),
        candidate,
      });
    });

    // ── voice:mute-self ────────────────────────────────────────────────── FR-47
    // Voluntary self-mute toggle
    socket.on('voice:mute-self', ({ isMuted }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      const participant = voiceRoom.participants.get(socket.id);
      if (!participant) return;

      // Security: FR-49 Hard-mute enforcement
      // If a participant was hard-muted by the Room Leader, they CANNOT self-unmute over the socket
      if (participant.isHardMuted && !isMuted) {
        return socket.emit('voice:error', {
          message: 'You have been hard-muted by the Room Leader. You cannot unmute yourself.',
        });
      }

      participant.isMuted = Boolean(isMuted);

      voiceNs.to(socket.roomUuid).emit('voice:mute-changed', {
        userId:     participant.userId,
        socketId:   socket.id,
        isMuted:    participant.isMuted,
        isHardMuted: participant.isHardMuted,
      });
    });

    // ── voice:mute-participant — Room Leader hard mute (FR-48) ────────────────
    // Security: Only Owner and Room Leader can force-mute other participants
    socket.on('voice:mute-participant', ({ targetSocketId, hard = false }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      // Security: Check sender's role permissions
      const myRole = getSocketRole(voiceRoom, socket.id);
      if (!isLeader(myRole)) {
        return socket.emit('voice:error', { message: 'Only Owners and Room Leaders can mute participants.' });
      }

      const target = voiceRoom.participants.get(targetSocketId);
      if (!target) return socket.emit('voice:error', { message: 'Target participant not found in voice channel.' });

      target.isMuted     = true;
      target.isHardMuted = Boolean(hard);

      // Notify the muted user with personal alert message
      const myInfo = voiceRoom.participants.get(socket.id);
      voiceNs.to(targetSocketId).emit('voice:muted-by-leader', {
        by:   myInfo?.displayName || 'Room Leader',
        hard: target.isHardMuted,
        message: `You were ${target.isHardMuted ? 'hard-muted' : 'muted'} by ${myInfo?.displayName || 'the Room Leader'}.`,
      });

      // Broadcast mute state change to all room participants
      voiceNs.to(socket.roomUuid).emit('voice:mute-changed', {
        userId:     target.userId,
        socketId:   targetSocketId,
        isMuted:    target.isMuted,
        isHardMuted: target.isHardMuted,
      });

      console.log(`🔇 "${myInfo?.displayName}" ${hard ? 'hard-' : ''}muted "${target.displayName}" in ${socket.roomUuid}`);
    });

    // ── voice:unmute-participant — Release hard mute (FR-48) ─────────────────
    // Security: Only Owner and Room Leader can release a hard-mute
    socket.on('voice:unmute-participant', ({ targetSocketId }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      const myRole = getSocketRole(voiceRoom, socket.id);
      if (!isLeader(myRole)) {
        return socket.emit('voice:error', { message: 'Only Owners and Room Leaders can unmute participants.' });
      }

      const target = voiceRoom.participants.get(targetSocketId);
      if (!target) return;

      target.isMuted     = false;
      target.isHardMuted = false;

      voiceNs.to(socket.roomUuid).emit('voice:mute-changed', {
        userId:     target.userId,
        socketId:   targetSocketId,
        isMuted:    false,
        isHardMuted: false,
      });
    });

    // ── voice:mute-all — Room Leader mutes all (FR-50) ───────────────────────
    // Security: Soft-mutes all participants except the issuing leader
    socket.on('voice:mute-all', () => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      const myRole = getSocketRole(voiceRoom, socket.id);
      if (!isLeader(myRole)) {
        return socket.emit('voice:error', { message: 'Only Owners and Room Leaders can mute all.' });
      }

      const myInfo = voiceRoom.participants.get(socket.id);

      // Soft mute everyone except the leader who issued the command
      voiceRoom.participants.forEach((participant, sid) => {
        if (sid !== socket.id) {
          participant.isMuted = true;
          // Soft mute only — participants may self-unmute afterwards per FR-50 specification
        }
      });

      voiceNs.to(socket.roomUuid).emit('voice:participants-update', {
        participants: serializeParticipants(voiceRoom),
        event: 'mute-all',
        by:    myInfo?.displayName || 'Room Leader',
      });

      console.log(`🔇 "${myInfo?.displayName}" muted all in ${socket.roomUuid}`);
    });

    // ── voice:set-editor-only — Toggle editor-only access (FR-51) ────────────
    // Security: Only Owner and Room Leader can restrict voice channel to Editors
    socket.on('voice:set-editor-only', ({ enabled }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      const myRole = getSocketRole(voiceRoom, socket.id);
      if (!isLeader(myRole)) {
        return socket.emit('voice:error', { message: 'Only Owners and Room Leaders can change voice access settings.' });
      }

      voiceRoom.editorOnlyMode = Boolean(enabled);

      voiceNs.to(socket.roomUuid).emit('voice:room-settings', {
        editorOnlyMode: voiceRoom.editorOnlyMode,
      });

      console.log(`🎙️  Editor-only voice mode ${voiceRoom.editorOnlyMode ? 'enabled' : 'disabled'} in ${socket.roomUuid}`);
    });

    // ── Disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`🎙️  Voice socket disconnected: ${socket.user.displayName} — ${reason}`);
      leaveVoiceRoom(socket, voiceNs);
    });
  });

  console.log('🎙️  Voice signalling attached to /voice namespace.');
}

// ─── Shared Leave Helper ──────────────────────────────────────────────────────

/**
 * Removes a socket from its voice room, broadcasts departures to remaining peers,
 * and cleans up empty voice room structures to prevent memory leaks.
 *
 * @function leaveVoiceRoom
 * @param {import('socket.io').Socket} socket - Socket instance leaving voice
 * @param {import('socket.io').Namespace} voiceNs - Voice Socket.IO namespace
 */
function leaveVoiceRoom(socket, voiceNs) {
  const roomUuid = socket.roomUuid;
  if (!roomUuid) return;

  const voiceRoom = voiceRooms.get(roomUuid);
  if (!voiceRoom) return;

  const departed = voiceRoom.participants.get(socket.id);
  voiceRoom.participants.delete(socket.id);
  socket.leave(roomUuid);
  socket.roomUuid = null;

  if (!departed) return;

  console.log(`🎙️  [-] "${departed.displayName}" left voice in room ${roomUuid} (${voiceRoom.participants.size} remaining)`);

  voiceNs.to(roomUuid).emit('voice:participant-left', {
    userId:       departed.userId,
    socketId:     socket.id,
    displayName:  departed.displayName,
    participants: serializeParticipants(voiceRoom),
  });

  // Clean up empty voice rooms to prevent memory leaks
  if (voiceRoom.participants.size === 0) {
    voiceRooms.delete(roomUuid);
  }
}

module.exports = { initVoiceSignalling, voiceRooms };
