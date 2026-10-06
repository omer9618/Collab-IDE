/**
 * @file modules/websocket-relay/index.js
 * @module modules/websocket-relay
 * @description WebSocket Relay Module (FR-15 – FR-22, NFR-17, NFR-18, NFR-25, NFR-36, NFR-48, NFR-52).
 * 
 * Provides:
 * - Yjs real-time collaborative document synchronization over WebSockets
 * - Asymmetric RS256 token verification at the HTTP Upgrade boundary
 * - Authoritative server-side role binding (preventing Viewer file tampering)
 * - Per-room connection capacity enforcement (NFR-36, default 20 sockets/room)
 * - Dynamic room presence tracking and isolated room message routing (NFR-52)
 * - Independent testability without full HTTP/DB monolith coupling (NFR-48)
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

// Default internal dependencies (fallbacks when not injected)
const defaultLogger = require('../../utils/logger');
const { publicKey: defaultPublicKey } = require('../../utils/keys');
const defaultRoomManager = require('../../services/roomManager');
let DefaultUser;
let DefaultRoom;
try {
  DefaultUser = require('../../models/User');
  DefaultRoom = require('../../models/Room');
} catch (e) {
  // Models may be mocked during isolated tests
}

/**
 * Resolves maximum allowed concurrent WebSockets per room (NFR-36).
 *
 * @function getMaxWsPerRoom
 * @param {object} [env=process.env] - Environment configuration
 * @returns {number} Allowed connection ceiling (default: 20)
 */
function getMaxWsPerRoom(env = process.env) {
  const envVal = parseInt(env.MAX_WS_PER_ROOM || env.ROOM_WS_LIMIT, 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 20;
}

/**
 * Creates a serialized Yjs Sync Step 1 binary frame for document state discovery.
 *
 * @function createSyncStep1Message
 * @param {import('yjs').Doc} ydoc - Yjs document instance
 * @returns {Uint8Array} Binary SyncStep1 frame
 */
function createSyncStep1Message(ydoc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync = 0
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return encoding.toUint8Array(encoder);
}

/**
 * Updates room's lastActiveAt timestamp in MongoDB without touching updatedAt (FR-14).
 *
 * @async
 * @function touchRoomActivity
 * @param {string} roomUuid - Target room UUID
 * @param {object} [options={}] - Optional injected models
 * @returns {Promise<void>}
 */
async function touchRoomActivity(roomUuid, options = {}) {
  const RoomModel = options.Room || DefaultRoom;
  const log = options.logger || defaultLogger;
  if (!RoomModel) return;

  try {
    await RoomModel.updateOne(
      { uuid: roomUuid },
      { $set: { lastActiveAt: new Date() } },
      { timestamps: false }
    );
  } catch (err) {
    if (log && log.error) {
      log.error('Error touching lastActiveAt: ' + err.message, { roomId: roomUuid });
    }
  }
}

/**
 * Verifies RS256 token and validates user room membership for HTTP Upgrade requests (NFR-17, NFR-25).
 * Designed for independent unit and integration testing without requiring raw TCP sockets.
 *
 * @async
 * @function verifyUpgradeToken
 * @param {string} token - RS256 Bearer access token
 * @param {string} roomUuid - Target room identifier
 * @param {object} [options={}] - Injected dependencies (publicKey, User, Room, logger)
 * @returns {Promise<{ valid: boolean, user?: object, role?: string, roomUuid?: string, status?: number, error?: string }>}
 */
async function verifyUpgradeToken(token, roomUuid, options = {}) {
  const key = options.publicKey || defaultPublicKey;
  const UserModel = options.User || DefaultUser;
  const RoomModel = options.Room || DefaultRoom;
  const log = options.logger || defaultLogger;

  if (!token) {
    if (log && log.warn) log.warn('Upgrade rejected: No token provided', { roomId: roomUuid });
    return { valid: false, status: 401, error: 'No token provided' };
  }

  try {
    const decoded = jwt.verify(token, key, { algorithms: ['RS256'] });
    if (!decoded || !decoded.userId) {
      return { valid: false, status: 401, error: 'Invalid token payload' };
    }

    if (!UserModel) {
      return { valid: false, status: 500, error: 'User model unavailable' };
    }

    const user = await UserModel.findById(decoded.userId).select('-password');
    if (!user) {
      if (log && log.warn) log.warn('Upgrade rejected: User not found', { userId: decoded.userId, roomId: roomUuid });
      return { valid: false, status: 401, error: 'User not found' };
    }

    if (!RoomModel) {
      return { valid: false, status: 500, error: 'Room model unavailable' };
    }

    const room = await RoomModel.findOne({ uuid: roomUuid }).select('participants');
    if (!room) {
      if (log && log.warn) log.warn('Upgrade rejected: Room not found', { userId: user._id, roomId: roomUuid });
      return { valid: false, status: 404, error: 'Room not found' };
    }

    const participant = room.participants?.find(
      (p) => (p.user?._id || p.user || '').toString() === user._id.toString()
    );
    if (!participant) {
      if (log && log.warn) log.warn('Upgrade rejected: User is not a member of room', { userId: user._id, roomId: roomUuid });
      return { valid: false, status: 403, error: 'User is not a member of room' };
    }

    return {
      valid: true,
      user,
      role: participant.role || 'Viewer',
      roomUuid,
    };
  } catch (error) {
    if (log && log.warn) log.warn('Upgrade rejected: Invalid or expired token', { roomId: roomUuid, error: error.message });
    return { valid: false, status: 401, error: 'Invalid or expired token', details: error.message };
  }
}

/**
 * Creates an activeDocs Map-like proxy for backward-compatibility with tests (NFR-38, NFR-52).
 *
 * @function createActiveDocsProxy
 * @param {object} manager - RoomManager instance
 * @returns {object} Proxy object
 */
function createActiveDocsProxy(manager) {
  return {
    get size() {
      return manager.rooms.size;
    },
    has(roomUuid) {
      return manager.rooms.has(roomUuid);
    },
    get(roomUuid) {
      const session = manager.getRoom(roomUuid);
      return session ? { ydoc: session.ydoc, saveTimer: session.saveTimer } : undefined;
    },
    delete(roomUuid) {
      return manager.rooms.delete(roomUuid);
    },
    clear() {
      return manager.rooms.clear();
    },
    forEach(callback) {
      for (const [uuid, session] of manager.rooms.entries()) {
        callback({ ydoc: session.ydoc, saveTimer: session.saveTimer }, uuid);
      }
    },
    entries() {
      return Array.from(manager.rooms.entries()).map(([uuid, session]) => [
        uuid,
        { ydoc: session.ydoc, saveTimer: session.saveTimer },
      ]);
    },
  };
}

/**
 * Initializes the WebSocket Relay subsystem (NFR-48).
 * Attaches HTTP upgrade interception, initializes WebSocket Server, and registers
 * per-room collaborative synchronization listeners.
 *
 * @function initWebSocketRelay
 * @param {object} [options={}]
 * @param {import('http').Server} [options.server] - HTTP Server to bind upgrade listener
 * @param {WebSocket.Server} [options.wss] - Existing WebSocket server instance
 * @param {object} [options.roomManager] - RoomManager singleton
 * @param {object} [options.User] - User Mongoose model
 * @param {object} [options.Room] - Room Mongoose model
 * @param {string} [options.publicKey] - RS256 Public Key
 * @param {object} [options.logger] - Logger instance
 * @param {() => boolean} [options.getIsShuttingDown] - Shutdown predicate
 * @param {number|(() => number)} [options.maxWsPerRoom] - Max connections per room
 * @returns {object} Initialized WebSocket Relay interface
 */
function initWebSocketRelay(options = {}) {
  const server = options.server;
  const manager = options.roomManager || defaultRoomManager;
  const UserModel = options.User || DefaultUser;
  const RoomModel = options.Room || DefaultRoom;
  const key = options.publicKey || defaultPublicKey;
  const log = options.logger || defaultLogger;
  const getIsShuttingDown = options.getIsShuttingDown || (() => false);
  const resolveMaxWs = typeof options.maxWsPerRoom === 'function'
    ? options.maxWsPerRoom
    : typeof options.maxWsPerRoom === 'number'
      ? () => options.maxWsPerRoom
      : getMaxWsPerRoom;

  // Initialize or adopt WebSocket server with compression for sub-200ms latency (NFR-01)
  const wss = options.wss || new WebSocket.Server({ 
    noServer: true,
    perMessageDeflate: {
      zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
      zlibInflateOptions: { chunkSize: 10 * 1024 },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024,
    }
  });
  const activeDocs = createActiveDocsProxy(manager);

  // NFR-53: Configure distributed Pub/Sub adapter if supplied
  if (options.pubsubAdapter && typeof manager.setPubSubAdapter === 'function') {
    manager.setPubSubAdapter(options.pubsubAdapter);
  }

  // Helper bindings
  const getRoomConnectionCount = (roomUuid, excludeWs = null) => {
    return manager.getRoomConnectionCount(roomUuid, excludeWs);
  };

  const broadcastToRoom = (roomUuid, message) => {
    manager.broadcastToRoom(roomUuid, message);
  };

  const broadcastRoomParticipants = async (roomUuid) => {
    await manager.broadcastRoomParticipants(roomUuid);
  };

  const getRoomPresence = () => {
    return manager.getPresenceMap();
  };

  const updateClientRoleInMemory = (roomUuid, userId, newRole) => {
    manager.updateClientRole(roomUuid, userId, newRole);
  };

  // Register global helpers for backward compatibility across legacy route handlers
  global.broadcastToRoom = broadcastToRoom;
  global.broadcastRoomParticipants = broadcastRoomParticipants;
  global.getRoomPresence = getRoomPresence;
  global.updateClientRoleInMemory = updateClientRoleInMemory;

  // HTTP Upgrade Request Handler
  const handleUpgrade = async (request, socket, head) => {
    if (getIsShuttingDown()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const parsedUrl = new URL(request.url, 'http://localhost');

      // Ignore socket.io upgrade requests to prevent conflicts (delegated to Socket.IO engine)
      if (parsedUrl.pathname.startsWith('/socket.io')) {
        return;
      }

      const cleanPath = parsedUrl.pathname.replace(/^\/ws\/?/, '/');
      const roomUuid = cleanPath.slice(1);
      const token = parsedUrl.searchParams.get('token');

      const authResult = await verifyUpgradeToken(token, roomUuid, {
        publicKey: key,
        User: UserModel,
        Room: RoomModel,
        logger: log,
      });

      if (!authResult.valid) {
        const statusCode = authResult.status || 401;
        const statusText = statusCode === 404 ? 'Not Found' : statusCode === 403 ? 'Forbidden' : 'Unauthorized';
        socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\n\r\n`);
        socket.destroy();
        return;
      }

      // Authoritative server-verified metadata onto request context
      request.user = authResult.user;
      request.role = authResult.role;
      request.roomUuid = authResult.roomUuid;

      // Complete protocol upgrade
      // NFR-01: Explicitly disable Nagle's algorithm for sub-200ms real-time sync latency
      if (socket.setNoDelay) {
        socket.setNoDelay(true);
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch (err) {
      if (log && log.warn) log.warn('Upgrade rejected: Unexpected error: ' + err.message);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  };

  // Attach upgrade listener to HTTP server if provided
  if (server && typeof server.on === 'function') {
    server.on('upgrade', handleUpgrade);
  }

  // WebSocket Connection Handler
  const handleConnection = async (ws, req) => {
    const roomUuid = req.roomUuid;
    const user = req.user;
    const role = req.role;

    // Room capacity limit check (NFR-36, NFR-52)
    const maxLimit = resolveMaxWs();
    const currentRoomConnections = manager.getRoomConnectionCount(roomUuid, ws);

    if (currentRoomConnections >= maxLimit) {
      const errorMsg = `Room capacity exceeded (maximum ${maxLimit} connections per room).`;
      if (log && log.warn) {
        log.warn(`Room ${roomUuid} capacity exceeded (${currentRoomConnections}/${maxLimit}). Rejecting connection for user "${user?.displayName || 'anonymous'}".`);
      }

      ws.roomUuid = null;
      ws.userId = null;
      ws.role = null;

      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'ROOM_CAPACITY_EXCEEDED',
            message: errorMsg,
            limit: maxLimit,
            current: currentRoomConnections,
          })
        );
      } catch (err) {
        // Socket already closed
      }

      // RFC 6455 Close Code 1008: Policy Violation
      ws.close(1008, errorMsg);
      return;
    }

    // Buffer frames that arrive while the room session is loading asynchronously.
    // y-websocket clients send SyncStep1 immediately on open; without this buffer
    // that frame is dropped and the client never receives the server document state.
    const pendingFrames = [];
    let roomSessionRef = null;
    ws.on('message', (data, isBinary) => {
      if (roomSessionRef) {
        roomSessionRef.handleMessage(ws, data, isBinary);
      } else {
        pendingFrames.push([data, isBinary]);
      }
    });

    // Isolated room session (NFR-52)
    const roomSession = await manager.getOrCreateRoom(roomUuid);
    roomSession.addClient(ws, user, role);

    if (log && log.info) {
      log.info('Collaborator connected to workspace', { userId: user?._id, roomId: roomUuid, role });
    }

    // Touch room activity (FR-14)
    touchRoomActivity(roomUuid, { Room: RoomModel, logger: log });

    // Send initial Sync Step 1 frame
    const step1Payload = createSyncStep1Message(roomSession.ydoc);
    roomSession.safeSend(ws, step1Payload, true);

    // Route messages into room session boundary (flush frames buffered during room load)
    roomSessionRef = roomSession;
    pendingFrames.splice(0).forEach(([data, isBinary]) => {
      roomSession.handleMessage(ws, data, isBinary);
    });

    // Handle client disconnect
    ws.on('close', async () => {
      if (log && log.info) {
        log.info('Collaborator disconnected from workspace', { userId: user?._id, roomId: roomUuid });
      }
      touchRoomActivity(roomUuid, { Room: RoomModel, logger: log });

      roomSession.removeClient(ws);
    });

    // Handle socket errors
    ws.on('error', (err) => {
      if (log && log.error) {
        log.error('WS error: ' + err.message, { userId: ws.userId, roomId: ws.roomUuid });
      }
      roomSession.removeClient(ws);
    });
  };

  wss.on('connection', handleConnection);

  /**
   * Graceful close helper for WebSocket relay (NFR-38).
   *
   * @async
   * @function close
   * @returns {Promise<void>}
   */
  const close = () => {
    return new Promise((resolve) => {
      try {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.close(1001, 'Server shutting down');
          }
        });
        wss.close(() => resolve());
      } catch (err) {
        resolve();
      }
    });
  };

  return {
    name: 'websocket-relay',
    wss,
    activeDocs,
    handleUpgrade,
    handleConnection,
    verifyUpgradeToken,
    getMaxWsPerRoom: resolveMaxWs,
    createSyncStep1Message,
    touchRoomActivity: (uuid) => touchRoomActivity(uuid, { Room: RoomModel, logger: log }),
    broadcastToRoom,
    broadcastRoomParticipants,
    getRoomPresence,
    updateClientRoleInMemory,
    getRoomConnectionCount,
    close,
    pubsubAdapter: manager.pubsubAdapter,
    setPubSubAdapter: (adapter) => manager.setPubSubAdapter(adapter),
    horizontalScaling: {
      ready: true,
      supportsRedisAdapter: true,
      singleProcessAssumptions: false,
      pubsubChannels: ['collab:room:<uuid>'],
    },
  };
}

module.exports = {
  name: 'websocket-relay',
  initWebSocketRelay,
  createWebSocketRelay: initWebSocketRelay,
  verifyUpgradeToken,
  getMaxWsPerRoom,
  createSyncStep1Message,
  touchRoomActivity,
  createActiveDocsProxy,
  pubsub: require('../../services/pubsub'),
  horizontalScaling: {
    ready: true,
    supportsRedisAdapter: true,
    singleProcessAssumptions: false,
    pubsubChannels: ['collab:room:<uuid>'],
  },
};
