/**
 * socket/voice.js
 *
 * WebRTC Voice Chat Signalling Module — FR-45 to FR-53, NFR-29 to NFR-31
 *
 * Attaches to the Socket.IO /voice namespace.
 * All events relay SDP offers/answers and ICE candidates between peers (text only).
 * No audio bytes pass through this server (NFR-31).
 *
 * Usage:
 *   const { initVoiceSignalling } = require('./socket/voice');
 *   initVoiceSignalling(io);
 *
 * In-memory state shape:
 *   voiceRooms: Map<roomUuid, {
 *     participants: Map<socketId, {
 *       userId, displayName, avatarColor, role,
 *       isMuted, isHardMuted, joinedAt
 *     }>,
 *     editorOnlyMode: boolean
 *   }>
 */

const jwt  = require('jsonwebtoken');
const { publicKey } = require('../utils/keys');
const User = require('../models/User');
const Room = require('../models/Room');

// ─── In-Memory Voice State ────────────────────────────────────────────────────

/**
 * voiceRooms persists for the lifetime of the server process.
 * Exported so REST routes can read participant counts.
 */
const voiceRooms = new Map();

function getVoiceRoom(roomUuid) {
  if (!voiceRooms.has(roomUuid)) {
    voiceRooms.set(roomUuid, {
      participants: new Map(),
      editorOnlyMode: false,
    });
  }
  return voiceRooms.get(roomUuid);
}

/** Serialize a voiceRoom's participants to a plain array for broadcasting. */
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

// ─── Role Helper ──────────────────────────────────────────────────────────────

/** Returns the role of a socket's user in a given room (re-checked live from participants map). */
function getSocketRole(voiceRoom, socketId) {
  const p = voiceRoom.participants.get(socketId);
  return p?.role || null;
}

/** Returns true if the role can issue voice controls over others. */
function isLeader(role) {
  return role === 'Owner' || role === 'Room Leader';
}

// ─── Signalling Initialiser ───────────────────────────────────────────────────

/**
 * Attach all voice signalling logic to the /voice Socket.IO namespace.
 * Called once from server.js during startup, receives the io instance.
 *
 * @param {import('socket.io').Server} io
 */
function initVoiceSignalling(io) {
  const voiceNs = io.of('/voice');

  // ── Auth Middleware (NFR-17) ────────────────────────────────────────────────
  voiceNs.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('AUTH_REQUIRED'));

      const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      const user = await User.findById(decoded.userId).select('-password');

      if (!user) return next(new Error('USER_NOT_FOUND'));
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

    // Populated on voice:join
    socket.roomUuid = null;

    // ── voice:join ─────────────────────────────────────────────────────── FR-45
    socket.on('voice:join', async ({ roomUuid } = {}) => {
      try {
        if (!roomUuid) return socket.emit('voice:error', { message: 'roomUuid is required.' });

        // Verify the user is a room member
        const room = await Room.findOne({ uuid: roomUuid }).populate('participants.user', 'displayName email');
        if (!room) return socket.emit('voice:error', { message: 'Room not found.' });

        const member = room.participants.find(p => {
          const pId = p.user._id ? p.user._id.toString() : p.user.toString();
          return pId === socket.user._id.toString();
        });
        if (!member) return socket.emit('voice:error', { message: 'You are not a member of this room.' });

        const voiceRoom = getVoiceRoom(roomUuid);

        // FR-51: Editor-only mode check
        if (voiceRoom.editorOnlyMode && member.role === 'Viewer') {
          return socket.emit('voice:error', {
            message: 'Voice is restricted to Editors only in this room. Ask the Room Leader to grant you Editor access first.',
          });
        }

        // Detach from any previous voice room (handles re-join)
        if (socket.roomUuid && socket.roomUuid !== roomUuid) {
          leaveVoiceRoom(socket, voiceNs);
        }

        socket.roomUuid = roomUuid;
        socket.join(roomUuid); // Socket.IO room

        // Evict stale entries for the same user (prevents ghost duplicates on reconnect)
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

        // Tell everyone in the room (including the new joiner) the full updated list
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
    // All three relay events forward to a specific peer socket ID.
    // Server does NOT inspect SDP or candidate content (NFR-31).

    // voice:offer — SDP offer relay
    socket.on('voice:offer', ({ to, sdp }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;
      // Ensure both sockets are in the same voice room
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
    socket.on('voice:mute-self', ({ isMuted }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      const participant = voiceRoom.participants.get(socket.id);
      if (!participant) return;

      // Hard-muted participants cannot unmute themselves (FR-49)
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
    socket.on('voice:mute-participant', ({ targetSocketId, hard = false }) => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      const myRole = getSocketRole(voiceRoom, socket.id);
      if (!isLeader(myRole)) {
        return socket.emit('voice:error', { message: 'Only Owners and Room Leaders can mute participants.' });
      }

      const target = voiceRoom.participants.get(targetSocketId);
      if (!target) return socket.emit('voice:error', { message: 'Target participant not found in voice channel.' });

      target.isMuted     = true;
      target.isHardMuted = Boolean(hard);

      // Notify the muted user with a personal message (FR-48)
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
    socket.on('voice:mute-all', () => {
      if (!socket.roomUuid) return;
      const voiceRoom = voiceRooms.get(socket.roomUuid);
      if (!voiceRoom) return;

      const myRole = getSocketRole(voiceRoom, socket.id);
      if (!isLeader(myRole)) {
        return socket.emit('voice:error', { message: 'Only Owners and Room Leaders can mute all.' });
      }

      const myInfo = voiceRoom.participants.get(socket.id);

      // Mute everyone except the leader who issued the command
      voiceRoom.participants.forEach((participant, sid) => {
        if (sid !== socket.id) {
          participant.isMuted = true;
          // Soft mute only — participants may self-unmute after (FR-50 spec)
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
 * Remove a socket from its voice room, broadcast departure, and clean up.
 * Called on explicit voice:leave and on disconnect.
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

  // Clean up empty voice rooms to prevent memory leak
  if (voiceRoom.participants.size === 0) {
    voiceRooms.delete(roomUuid);
  }
}

module.exports = { initVoiceSignalling, voiceRooms };
