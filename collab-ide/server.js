/**
 * @file server.js
 * @module server
 * @description Core HTTP, WebSocket, and WebRTC signalling server for CollabIDE.
 * 
 * Provides:
 * - Express REST API router integration (Auth, Rooms, Execution, Voice)
 * - Yjs real-time collaborative document synchronization over WebSockets (FR-15 – FR-22)
 * - Asymmetric RS256 token verification at the HTTP Upgrade boundary (NFR-17, NFR-25)
 * - Server-side role enforcement preventing Viewer unauthorized file mutation (NFR-18)
 * - Dynamic room presence tracking and debounced MongoDB persistence (FR-14, NFR-26)
 * - Graceful process termination and buffer flushing (NFR-38)
 */

require('dotenv').config();
const logger = require('./utils/logger');
// NFR-23: Install universal console interceptor to sanitize logs and enforce chmod 640 storage
logger.installGlobalInterceptor();

const http = require('http');
const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const { roomManager } = require('./services/roomManager');

/**
 * Connects to MongoDB with connection pooling (NFR-40).
 * Configures pool bounds based on environment or production defaults.
 * 
 * @async
 * @function connectDB
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  const connUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/collabide';
  const mongoose = require('mongoose');
  try {
    const conn = await mongoose.connect(connUri, {
      maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '20', 10),
      minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10),
      maxIdleTimeMS: parseInt(process.env.MONGO_MAX_IDLE_TIME_MS || '30000', 10),
    });
    console.log(`🔌 MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

const User = require('./models/User');
const Room = require('./models/Room');
const { publicKey } = require('./utils/keys');

const authRoutes      = require('./routes/auth');
const roomRoutes      = require('./routes/rooms');
const executionRoutes = require('./routes/execution');
const voiceRoutes     = require('./routes/voice');
const { createHealthRouter } = require('./routes/health');
const { getHealthMetrics } = require('./services/healthCheck');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Initialize Socket.IO Server for Voice Signalling (FR-45 – FR-53)
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const { initVoiceSignalling } = require('./socket/voice');
initVoiceSignalling(io);

// Connect to Database
connectDB();

const { csrfProtection } = require('./middleware/csrf');

let isShuttingDown = false;

// NFR-38: Ingress cutoff during graceful shutdown
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.set('Connection', 'close');
    if (req.path === '/health' || req.path === '/health/') {
      return next();
    }
    return res.status(503).json({
      error: 'Server is shutting down',
      code: 'SERVER_SHUTTING_DOWN',
    });
  }
  next();
});

// Global Middlewares
app.use(cors({
  origin: true,
  credentials: true
}));

// NFR-42: Compression
// Compresses all text-based HTTP responses (HTML, JS, CSS, JSON) above 1KB (1024 bytes)
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);

// Static Client Files
app.use(express.static(path.join(__dirname, 'public')));

// Register REST Routes
app.use('/api/auth',      authRoutes);
app.use('/api/rooms',     roomRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/voice',     voiceRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function getMaxWsPerRoom() {
  const envVal = parseInt(process.env.MAX_WS_PER_ROOM || process.env.ROOM_WS_LIMIT, 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 20;
}

/**
 * Health Check Endpoint (NFR-39, NFR-48).
 * Modular health check route unauthenticated and unthrottled for process managers and monitors.
 * 
 * @route GET /health
 */
const healthRouter = createHealthRouter({
  getIsShuttingDown: () => isShuttingDown,
  roomManager,
  getMaxWsPerRoom,
});
app.use('/health', healthRouter);

// 404 Handler for Unmatched API Endpoints (NFR-47)
app.use('/api', notFoundHandler);

// Centralized Plain-English Error Sanitizer Middleware (NFR-47)
app.use(errorHandler);

// Initialize WebSocket Server
const wss = new WebSocket.Server({ noServer: true });

function getRoomConnectionCount(roomUuid, excludeWs = null) {
  return roomManager.getRoomConnectionCount(roomUuid, excludeWs);
}

/**
 * Backward-compatible activeDocs registry proxy (NFR-38, NFR-52).
 * Transparently delegates to roomManager.rooms while exposing Map-like interface.
 */
const activeDocs = {
  get size() {
    return roomManager.rooms.size;
  },
  has(roomUuid) {
    return roomManager.rooms.has(roomUuid);
  },
  get(roomUuid) {
    const session = roomManager.getRoom(roomUuid);
    return session ? { ydoc: session.ydoc, saveTimer: session.saveTimer } : undefined;
  },
  delete(roomUuid) {
    return roomManager.rooms.delete(roomUuid);
  },
  clear() {
    return roomManager.rooms.clear();
  },
  forEach(callback) {
    for (const [uuid, session] of roomManager.rooms.entries()) {
      callback({ ydoc: session.ydoc, saveTimer: session.saveTimer }, uuid);
    }
  },
  entries() {
    return Array.from(roomManager.rooms.entries()).map(([uuid, session]) => [
      uuid,
      { ydoc: session.ydoc, saveTimer: session.saveTimer },
    ]);
  },
};

/**
 * FR-14: Mark a room as active right now.
 * Sets `timestamps: false` to keep this update distinct from `updatedAt`.
 *
 * @async
 * @function touchRoomActivity
 * @param {string} roomUuid - Target room UUID
 * @returns {Promise<void>}
 */
async function touchRoomActivity(roomUuid) {
  try {
    await Room.updateOne(
      { uuid: roomUuid },
      { $set: { lastActiveAt: new Date() } },
      { timestamps: false }
    );
  } catch (err) {
    logger.error('Error touching lastActiveAt: ' + err.message, { roomId: roomUuid });
  }
}

/**
 * FR-14: Live presence snapshot for the room listing dashboard.
 * Derived directly from independent room client sets (NFR-52).
 *
 * @function getRoomPresence
 * @returns {Map<string, Set<string>>} Map of roomUuid to Set of active userIds
 */
global.getRoomPresence = () => {
  return roomManager.getPresenceMap();
};

/**
 * Atomic in-memory synchronization of user roles across active WebSockets (NFR-19, NFR-52).
 * Scoped strictly to the target room's client set.
 *
 * @function updateClientRoleInMemory
 * @param {string} roomUuid - Target room UUID
 * @param {string} userId - User ID whose role changed
 * @param {string} newRole - New role ('Owner' | 'Room Leader' | 'Editor' | 'Viewer')
 */
global.updateClientRoleInMemory = (roomUuid, userId, newRole) => {
  roomManager.updateClientRole(roomUuid, userId, newRole);
};

/**
 * Broadcasts a raw JSON string to every open WebSocket client connected to a specific room (FR-29, NFR-52).
 * Scoped strictly to the target room's client set.
 *
 * @function broadcastToRoom
 * @param {string} roomUuid - Destination room UUID
 * @param {string} message - JSON-serialized message payload
 */
global.broadcastToRoom = (roomUuid, message) => {
  roomManager.broadcastToRoom(roomUuid, message);
};

/**
 * Broadcasts updated participant list to all room clients (FR-44, NFR-52).
 *
 * @async
 * @function broadcastRoomParticipants
 * @param {string} roomUuid - Target room UUID
 * @returns {Promise<void>}
 */
global.broadcastRoomParticipants = async (roomUuid) => {
  await roomManager.broadcastRoomParticipants(roomUuid);
};

/**
 * HTTP Upgrade Handshake Auth Enforcer (NFR-17, NFR-25).
 *
 * SECURITY REASONING & PROTOCOL SPECIFICATION:
 * 1. Pre-Upgrade Authentication: Intercepts HTTP 101 Switching Protocols upgrade
 *    requests BEFORE completing the WebSocket handshake. If credentials or permissions
 *    are invalid, responds with raw HTTP 401/403/404 headers and destroys the TCP socket.
 *    This protects the event loop from unauthenticated WebSocket connection pooling attacks.
 * 2. RS256 Asymmetric Verification: Validates JWT access token extracted from query params
 *    against the server's public key, preventing token spoofing or algorithm confusion.
 * 3. Authoritative Role Binding: Looks up the room and verifies the user is an enrolled
 *    member. The user's role (`Viewer`, `Editor`, `Room Leader`, `Owner`) is attached directly
 *    to the internal `request` object. Clients CANNOT declare or modify their own role over WS.
 * 4. Namespace Isolation: Ignores `/socket.io` paths so Socket.IO voice signalling can
 *    handle its own handshake independently.
 */
server.on('upgrade', async (request, socket, head) => {
  if (isShuttingDown) {
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

    // Security: Reject unauthenticated upgrade attempts immediately
    if (!token) {
      logger.warn('Upgrade rejected: No token provided', { roomId: roomUuid });
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Security: RS256 signature verification guarantees authenticity and tamper-proofing
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      logger.warn('Upgrade rejected: User not found', { userId: decoded?.userId, roomId: roomUuid });
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Security: Verify room existence and membership to prevent unauthorized buffer snooping (NFR-25)
    const room = await Room.findOne({ uuid: roomUuid });
    if (!room) {
      logger.warn('Upgrade rejected: Room not found', { userId: user._id, roomId: roomUuid });
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const participant = room.participants.find(p => p.user.toString() === user._id.toString());
    if (!participant) {
      logger.warn('Upgrade rejected: User is not a member of room', { userId: user._id, roomId: roomUuid });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Security: Inject authoritative server-verified metadata onto request context
    request.user = user;
    request.role = participant.role;
    request.roomUuid = roomUuid;

    // Proceed with WebSocket protocol upgrade
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } catch (error) {
    logger.warn('Upgrade rejected: Invalid or expired token', { roomId: roomUuid });
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

/**
 * WebSocket Connection Handler — Yjs CRDT Synchronization & Server Role Enforcer (FR-15 – FR-22).
 *
 * WEBSOCKET MESSAGE PROTOCOL & ROLE ENFORCEMENT SECURITY REASONING:
 * -----------------------------------------------------------------------------
 * 1. Protocol Framing:
 *    - Binary Frames: Yjs protocol frames encoded with `lib0/encoding`.
 *      - Byte 0: Message family (`0` = syncProtocol, `1` = awarenessProtocol, `2` = authProtocol).
 *      - Sync Message Subtypes (following byte 0):
 *        - `0` (SyncStep1): Initial handshake; client or server announces state vector.
 *        - `1` (SyncStep2): Response payload containing missing document updates.
 *        - `2` (Update): Incremental CRDT insertion or deletion delta.
 *    - JSON Text Frames: Used for server control signals (`role_update`, `room_closed`, `exec:result`).
 *
 * 2. Role Enforcement Logic (NFR-18):
 *    - Client-side read-only flags (e.g. Monaco `readOnly: true`) are cosmetic and can be bypassed
 *      by an attacker emitting raw WebSocket binary frames or running browser scripts.
 *    - Server-side Gate: When `ws.role === 'Viewer'`, every incoming binary update (`cleanData[0] === 0`
 *      and `msgType === 1 || msgType === 2`) is parsed and deeply inspected.
 *    - Inspection Mechanics: The server decodes the binary update struct array (`Y.decodeUpdate`)
 *      and checks the `struct.parent` of each operation.
 *    - Selective Write Barrier:
 *      - Operations targeting `:chat` (group chat) are ALLOWED for Viewers (satisfying FR-34).
 *      - Operations targeting any code file (e.g. `${roomUuid}:main.js`) are DROPPED SILENTLY.
 *    - This guarantees that Viewers cannot corrupt or modify project source files, maintaining
 *      authoritative document integrity on the server.
 *
 * 3. Cross-Room Isolation (NFR-52):
 *    - Relay loop strictly checks `client.roomUuid === ws.roomUuid`. Messages are never broadcast
 *      outside the sender's authenticated room context.
 *
 * 4. Room Capacity Ceiling (NFR-36):
 *    - Hard ceiling of 20 concurrent connections per room prevents resource starvation.
 */
wss.on('connection', async (ws, req) => {
  const roomUuid = req.roomUuid;
  const user = req.user;
  const role = req.role;

  // Max room capacity check (NFR-36, NFR-52)
  const maxLimit = getMaxWsPerRoom();
  const currentRoomConnections = roomManager.getRoomConnectionCount(roomUuid, ws);

  if (currentRoomConnections >= maxLimit) {
    const errorMsg = `Room capacity exceeded (maximum ${maxLimit} connections per room).`;
    logger.warn(`Room ${roomUuid} capacity exceeded (${currentRoomConnections}/${maxLimit}). Rejecting connection for user "${user.displayName}".`);

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

  // NFR-52: Get or create isolated RoomSession (encapsulates Y.Doc, client set, rate limits)
  const roomSession = await roomManager.getOrCreateRoom(roomUuid);

  // Register client in room's isolated client set (NFR-52)
  roomSession.addClient(ws, user, role);

  logger.info('Collaborator connected to workspace', { userId: user._id, roomId: roomUuid, role });

  // FR-14: record user presence
  touchRoomActivity(roomUuid);

  // Protocol: Emit Sync Step 1 to trigger state synchronization with the joining client
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync = 0
  syncProtocol.writeSyncStep1(encoder, roomSession.ydoc);
  roomSession.safeSend(ws, encoding.toUint8Array(encoder), true);

  // Route incoming WebSocket messages directly into isolated room error boundary (NFR-52)
  ws.on('message', (data, isBinary) => {
    roomSession.handleMessage(ws, data, isBinary);
  });

  // Handle client disconnection
  ws.on('close', async () => {
    logger.info('Collaborator disconnected from workspace', { userId: user._id, roomId: roomUuid });
    touchRoomActivity(roomUuid);

    const remaining = roomSession.removeClient(ws);

    // Unload empty rooms from RAM to prevent memory leaks (NFR-38, NFR-52)
    if (remaining === 0) {
      await roomManager.unloadRoom(roomUuid);
    }
  });

  ws.on('error', (err) => {
    logger.error('WS error: ' + err.message, { userId: ws.userId, roomId: ws.roomUuid });
    roomSession.removeClient(ws);
  });
});

// PM2 & Container Graceful Shutdown (NFR-38)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// IPC shutdown trigger support (for automated test runners & orchestrators)
process.on('message', (msg) => {
  if (msg === 'shutdown' || msg?.action === 'shutdown') {
    gracefulShutdown('SIGTERM');
  }
});

/**
 * Handles graceful process termination on SIGTERM/SIGINT signals (NFR-38).
 * Flushes all pending in-memory Yjs documents to MongoDB before terminating
 * Express and WebSocket servers, preventing data loss during rolling deployments.
 *
 * @async
 * @function gracefulShutdown
 * @param {string} [signal='SIGTERM'] - Signal received
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal = 'SIGTERM') {
  if (isShuttingDown) {
    // In local development, a second Ctrl+C forces immediate termination
    if (process.env.NODE_ENV !== 'production' && signal === 'SIGINT') {
      console.warn('\n⚠️  Second SIGINT received in development. Forcing immediate termination.');
      process.exit(1);
    }
    console.log(`\n⚠️  ${signal} received while already shutting down. Ignoring redundant signal.`);
    return;
  }

  isShuttingDown = true;
  console.log(`\n🛑 ${signal} received. Commencing graceful shutdown (NFR-38)...`);

  // Track pending rooms for diagnostic reporting if watchdog triggers
  const pendingRooms = new Set(roomManager.rooms.keys());

  // Watchdog timer: default 10,000ms per NFR-38 specification (configurable via SHUTDOWN_TIMEOUT_MS)
  const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 10000;
  const watchdog = setTimeout(() => {
    console.error(`\n❌ Watchdog timeout (${SHUTDOWN_TIMEOUT_MS}ms limit reached). Forcing exit.`);
    if (pendingRooms.size > 0) {
      console.error(`⚠️  Unpersisted or in-flight rooms at termination: [${Array.from(pendingRooms).join(', ')}]`);
    }
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  if (watchdog.unref) watchdog.unref();

  try {
    // 1. Immediately terminate idle HTTP keep-alive connections so server.close() is not stalled
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }

    // 2. Stop accepting new TCP connections immediately
    const closeServerPromise = new Promise((resolve) => {
      server.close((err) => {
        if (err) console.error('Error closing HTTP server:', err.message);
        else console.log('🚪 HTTP/Express server closed to new connections.');
        resolve();
      });
    });

    // 3. Gracefully notify and close active real-time connections (WebSockets & Socket.IO)
    try {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1001, 'Server shutting down'); // 1001 = Going Away
        }
      });
      wss.close(() => console.log('🔌 WebSocket server closed.'));

      io.disconnectSockets(true);
      io.close(() => console.log('🎙️  Socket.IO voice server closed.'));
    } catch (err) {
      console.error('Error closing real-time connections:', err.message);
    }

    // 4. Persist all active room documents to MongoDB (NFR-38, NFR-52)
    console.log(`💾 Persisting ${pendingRooms.size} active Yjs room documents to MongoDB...`);
    await roomManager.persistAllRooms();
    console.log(`💾 Yjs persistence complete. Remaining active rooms: ${roomManager.rooms.size}`);
    pendingRooms.clear();

    // 5. Await complete drain of any in-flight HTTP requests
    await closeServerPromise;

    // 6. Gracefully close MongoDB connection pool (NFR-40)
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.connection.close(false);
        console.log('🔌 MongoDB connection pool closed gracefully.');
      } catch (err) {
        console.error('Error closing MongoDB connection:', err.message);
      }
    }

    clearTimeout(watchdog);
    console.log('✅ Graceful shutdown completed cleanly. Exiting process.\n');
    process.exit(0);
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  connectDB();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n✅  Collide Backend → http://localhost:${PORT}`);
    console.log(`⚡  JWT Asymmetric signatures initialized.\n`);
    // PM2 readiness notification (NFR-32, NFR-39)
    if (typeof process.send === 'function') {
      process.send('ready');
    }
  });
}

module.exports = { app, server, connectDB, getHealthMetrics };

