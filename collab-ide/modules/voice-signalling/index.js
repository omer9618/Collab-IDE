/**
 * @file modules/voice-signalling/index.js
 * @module modules/voice-signalling
 * @description WebRTC Voice Chat Signalling Module (FR-45 – FR-53, NFR-29 – NFR-31, NFR-48).
 * 
 * Encapsulates:
 * - Socket.IO `/voice` namespace attachment and mesh signalling relay
 * - Ephemeral HMAC-SHA1 TURN credential generation with 1-hour TTL (NFR-30)
 * - ICE server configuration construction (Google STUN, Open Relay, Coturn)
 * - Zero audio on server privacy architecture (NFR-31)
 * - Voice room participant tracking and role-based moderation
 */

const voiceRoutes = require('../../routes/voice');
const voiceSocket = require('../../socket/voice');

module.exports = {
  name: 'voice-signalling',
  routes: voiceRoutes,
  router: voiceRoutes,
  socket: voiceSocket,
  initVoiceSignalling: voiceSocket.initVoiceSignalling,
  voiceRooms: voiceSocket.voiceRooms,
  getVoiceRoom: voiceSocket.getVoiceRoom,
  serializeParticipants: voiceSocket.serializeParticipants,
  getSocketRole: voiceSocket.getSocketRole,
  leaveVoiceRoom: voiceSocket.leaveVoiceRoom,
  generateTurnCredentials: voiceRoutes.generateTurnCredentials,
  buildIceServers: voiceRoutes.buildIceServers,
};
