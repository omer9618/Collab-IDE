/**
 * @file modules/rooms/index.js
 * @module modules/rooms
 * @description Collaborative Rooms & Workspaces Module (FR-15 – FR-26, NFR-18, NFR-25, NFR-48, NFR-52).
 * 
 * Encapsulates:
 * - Room lifecycle management (creation, settings, file tree, membership, deletion)
 * - Role-Based Access Control (Owner, Room Leader, Editor, Viewer)
 * - Isolated RoomSession state containers (Y.Doc, rate limiters, isolated client sets)
 * - Auto-persistence and empty room memory deallocation (NFR-38, NFR-52)
 * - RoomManager singleton and isolated session classes
 */

const roomRoutes = require('../../routes/rooms');
const Room = require('../../models/Room');
const roomManager = require('../../services/roomManager');

module.exports = {
  name: 'rooms',
  routes: roomRoutes,
  router: roomRoutes,
  models: {
    Room,
  },
  roomManager,
  RoomManager: roomManager.RoomManager,
  RoomSession: roomManager.RoomSession,
  constants: {
    MAX_WS_FRAME_BYTES: roomManager.MAX_WS_FRAME_BYTES,
    MAX_MSGS_PER_SEC_PER_CLIENT: roomManager.MAX_MSGS_PER_SEC_PER_CLIENT,
    FLOOD_THRESHOLD_PER_SEC: roomManager.FLOOD_THRESHOLD_PER_SEC,
  },
  getPresenceMap: () => roomManager.getPresenceMap(),
  updateClientRole: (roomUuid, userId, newRole) => roomManager.updateClientRole(roomUuid, userId, newRole),
  broadcastToRoom: (roomUuid, message) => roomManager.broadcastToRoom(roomUuid, message),
  broadcastRoomParticipants: async (roomUuid) => roomManager.broadcastRoomParticipants(roomUuid),
};
