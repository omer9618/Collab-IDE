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

if (process.env.SKIP_DOTENV !== 'true') {
  require('dotenv').config();
}

// Fail-Fast Environment Configuration Validator (NFR-49)
// Must execute before any subsystem, database connection, or socket initializes
const { validateEnv } = require('./config/env');
validateEnv(process.env, { exitOnError: true });

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
const { Server } = require('socket.io');

// CollabIDE Independent Modules (NFR-48)
const {
  auth,
  rooms,
  websocketRelay,
  execution,
  voiceSignalling,
  infrastructure,
} = require('./modules');

const { connectDB } = infrastructure.database;
const { roomManager } = rooms;
const { User } = auth.models;
const { Room } = rooms.models;
const { publicKey } = auth.keys;
const { createHealthRouter, getHealthMetrics } = infrastructure.health;
const { errorHandler, notFoundHandler } = infrastructure.errorHandler;
const { csrfProtection } = infrastructure.csrf;

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Initialize Socket.IO Server for Voice Signalling (FR-45 – FR-53, NFR-48)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
voiceSignalling.initVoiceSignalling(io);

// Connect to Database with connection pooling (NFR-40)
connectDB();

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

// Register REST Routes (Modular architecture NFR-48)
app.use('/api/auth',      auth.routes);
app.use('/api/rooms',     rooms.routes);
app.use('/api/execution', execution.routes);
app.use('/api/voice',     voiceSignalling.routes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const getMaxWsPerRoom = websocketRelay.getMaxWsPerRoom;

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

// Initialize Modular WebSocket Relay Subsystem (NFR-48, NFR-52, NFR-17, NFR-36)
const {
  wss,
  activeDocs,
  touchRoomActivity,
  getRoomConnectionCount,
  broadcastToRoom,
  broadcastRoomParticipants,
  getRoomPresence,
  updateClientRoleInMemory,
} = websocketRelay.initWebSocketRelay({
  server,
  roomManager,
  User,
  Room,
  publicKey,
  logger,
  getIsShuttingDown: () => isShuttingDown,
  maxWsPerRoom: getMaxWsPerRoom,
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

module.exports = { app, server, connectDB, getHealthMetrics, wss, activeDocs };

