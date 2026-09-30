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
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

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

// Global Middlewares
app.use(cors({
  origin: true,
  credentials: true
}));
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

/**
 * Health Check Endpoint (NFR-39).
 * Returns system health, process uptime, memory allocations, and active collaborative room count.
 * 
 * @route GET /health
 */
app.get('/health', (req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'shutting_down' });
  }
  const mongoose = require('mongoose');
  const client = mongoose.connection.getClient ? mongoose.connection.getClient() : null;
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    activeRooms: activeDocs.size,
    activeWebSockets: Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN).length,
    maxWsPerRoom: getMaxWsPerRoom(),
    database: {
      connected: mongoose.connection.readyState === 1,
      minPoolSize: client?.options?.minPoolSize ?? 5,
      maxPoolSize: client?.options?.maxPoolSize ?? 20,
      maxIdleTimeMS: client?.options?.maxIdleTimeMS ?? 30000,
    },
  });
});

// 404 Handler for Unmatched API Endpoints (NFR-47)
app.use('/api', notFoundHandler);

// Centralized Plain-English Error Sanitizer Middleware (NFR-47)
app.use(errorHandler);

// Initialize WebSocket Server
const wss = new WebSocket.Server({ noServer: true });

/**
 * In-memory registry of active collaborative rooms.
 * Maps room UUID to its live Y.Doc instance and scheduled database persistence timer.
 * @type {Map<string, { ydoc: Y.Doc, saveTimer: NodeJS.Timeout|null }>}
 */
const activeDocs = new Map();

/**
 * Persists live in-memory Yjs document state and files to MongoDB (NFR-26).
 * Extracts text contents for human-readable querying and saves the binary
 * state vector (`ydocState`) to preserve CRDT state vectors across restarts.
 *
 * @async
 * @function saveRoomStateToDB
 * @param {string} roomUuid - UUID identifier of the room to persist
 * @param {Y.Doc} ydoc - In-memory Yjs CRDT document
 * @returns {Promise<void>}
 */
async function saveRoomStateToDB(roomUuid, ydoc) {
  try {
    if (process.env.TEST_SIMULATE_SLOW_ROOM && roomUuid.includes(process.env.TEST_SIMULATE_SLOW_ROOM)) {
      const delay = parseInt(process.env.TEST_PERSISTENCE_DELAY_MS, 10) || 30000;
      console.log(`[TEST HOOK] Artificially delaying persistence of room ${roomUuid} for ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const room = await Room.findOne({ uuid: roomUuid });
    if (!room) return;

    // Extract files list from Yjs shared files array (dynamic source of truth)
    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    const fileNames = yfiles.length > 0 ? yfiles.toArray() : room.files.map(f => f.name);
    // Deduplicate file names to handle legacy or race conditions
    const uniqueFileNames = Array.from(new Set(fileNames));

    const updatedFiles = uniqueFileNames.map(name => {
      const ytext = ydoc.getText(`${roomUuid}:${name}`);
      return {
        name,
        content: ytext.toString()
      };
    });

    const ydocStateUpdate = Y.encodeStateAsUpdate(ydoc);
    const ydocStateBuffer = Buffer.from(ydocStateUpdate);

    await Room.updateOne(
      { uuid: roomUuid },
      { 
        $set: { 
          files: updatedFiles,
          ydocState: ydocStateBuffer,
          // FR-14: editing the document counts as user activity
          lastActiveAt: new Date()
        } 
      }
    );
    logger.info('Persisted room state to MongoDB', { roomId: roomUuid });
  } catch (err) {
    logger.error('Error saving room state to DB: ' + err.message, { roomId: roomUuid });
  }
}

/**
 * Schedules a debounced database write for a room document (NFR-26).
 * Coalesces rapid keystrokes within 2000ms into a single write operation,
 * reducing MongoDB disk I/O under concurrent multi-user editing.
 *
 * @function scheduleSave
 * @param {string} roomUuid - Target room UUID
 */
function scheduleSave(roomUuid) {
  const docState = activeDocs.get(roomUuid);
  if (!docState) return;

  if (docState.saveTimer) {
    clearTimeout(docState.saveTimer);
  }

  docState.saveTimer = setTimeout(async () => {
    await saveRoomStateToDB(roomUuid, docState.ydoc);
  }, 2000);
}

/**
 * Retrieves an existing in-memory Y.Doc for a room or hydrates it from MongoDB.
 * If a binary snapshot (`ydocState`) exists, it is restored preserving CRDT clocks.
 *
 * @async
 * @function getOrCreateYdoc
 * @param {string} roomUuid - Unique room identifier
 * @returns {Promise<{ ydoc: Y.Doc, saveTimer: NodeJS.Timeout|null }>} Active document state
 */
async function getOrCreateYdoc(roomUuid) {
  if (activeDocs.has(roomUuid)) {
    return activeDocs.get(roomUuid);
  }

  const room = await Room.findOne({ uuid: roomUuid });
  const ydoc = new Y.Doc();

  if (room) {
    if (room.ydocState) {
      // Restore Yjs document using binary state snapshot to preserve clocks and client IDs
      try {
        const bufferData = room.ydocState;
        // MUST use byteOffset and length to avoid pulling garbage bytes from Node's shared memory pool!
        const uint8Array = new Uint8Array(bufferData.buffer, bufferData.byteOffset, bufferData.length);
        Y.applyUpdate(ydoc, uint8Array);
      } catch (err) {
        logger.error('Failed to apply ydocState: ' + err.message, { roomId: roomUuid });
      }

      // Self-healing: if legacy room has ydocState but files array is empty, initialize it on the server
      const yfiles = ydoc.getArray(`${roomUuid}:files`);
      if (yfiles.length === 0 && room.files && room.files.length > 0) {
        const fileNames = Array.from(new Set(room.files.map(f => f.name)));
        yfiles.push(fileNames);
        
        // Populate actual contents if ydoc was completely empty (e.g. corrupted buffer recovery)
        room.files.forEach(file => {
          const ytext = ydoc.getText(`${roomUuid}:${file.name}`);
          if (ytext.toString() === '') {
            ydoc.transact(() => {
              ytext.insert(0, file.content || '');
            });
          }
        });
      }
    } else if (room.files) {
      // Fallback for first-time room load: populate via text insert
      const yfiles = ydoc.getArray(`${roomUuid}:files`);
      const fileNames = Array.from(new Set(room.files.map(f => f.name)));
      yfiles.push(fileNames);

      room.files.forEach(file => {
        const ytext = ydoc.getText(`${roomUuid}:${file.name}`);
        ydoc.transact(() => {
          ytext.insert(0, file.content || '');
        });
      });
    }
  }

  // Auto save on any document update
  ydoc.on('update', () => {
    scheduleSave(roomUuid);
  });

  const docState = {
    ydoc,
    saveTimer: null,
  };

  activeDocs.set(roomUuid, docState);
  return docState;
}

/**
 * FR-14: Live presence snapshot for the room listing dashboard.
 *
 * Derived directly from open WebSocket connections rather than a separate
 * presence store, ensuring the count never drifts out of sync with reality.
 * Keyed by roomUuid; value is a Set of userIds, so a user with multiple tabs
 * open in the same room is counted as a single online participant.
 *
 * @function getRoomPresence
 * @returns {Map<string, Set<string>>} Map of roomUuid to Set of active userIds
 */
global.getRoomPresence = () => {
  const presence = new Map();

  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (!client.roomUuid || !client.userId) return;

    if (!presence.has(client.roomUuid)) {
      presence.set(client.roomUuid, new Set());
    }
    presence.get(client.roomUuid).add(client.userId);
  });

  return presence;
};

/**
 * FR-14: Mark a room as active right now.
 * Sets `timestamps: false` to keep this update distinct from `updatedAt`.
 * `updatedAt` tracks content/metadata modifications, while `lastActiveAt`
 * tracks real-time human presence.
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
    // Non-fatal: a missed activity timestamp must never break user sessions
    logger.error('Error touching lastActiveAt: ' + err.message, { roomId: roomUuid });
  }
}

/**
 * Atomic in-memory synchronization of user roles across active WebSockets (NFR-19).
 *
 * SECURITY REASONING:
 * When a user is demoted (e.g. Editor -> Viewer) via REST API, updating MongoDB
 * alone creates a vulnerability window because their existing WebSocket connection
 * retains Editor privileges until closed. This function iterates through connected
 * WebSocket clients, immediately updates their in-memory role tag, and dispatches
 * a `role_update` message to the client, closing the privilege revocation race condition.
 *
 * @function updateClientRoleInMemory
 * @param {string} roomUuid - Target room UUID
 * @param {string} userId - User ID whose role changed
 * @param {string} newRole - New role ('Owner' | 'Room Leader' | 'Editor' | 'Viewer')
 */
global.updateClientRoleInMemory = (roomUuid, userId, newRole) => {
  wss.clients.forEach(client => {
    if (client.roomUuid === roomUuid && client.userId === userId.toString()) {
      client.role = newRole;
      try {
        client.send(JSON.stringify({ type: 'role_update', role: newRole }));
      } catch (err) {
        logger.error('Error sending role update to client:', { userId, roomId: roomUuid, error: err.message });
      }
      logger.audit('ROLE_UPDATED', { userId, roomId: roomUuid, newRole });
    }
  });
};

/**
 * Broadcasts a raw JSON string to every open WebSocket client connected to a specific room.
 * Used by the execution route to broadcast execution results (`exec:result`) (FR-29)
 * and room closure notifications (FR-42).
 *
 * SECURITY REASONING:
 * Strictly filters by `client.roomUuid === roomUuid` to guarantee cross-room isolation (NFR-52).
 *
 * @function broadcastToRoom
 * @param {string} roomUuid - Destination room UUID
 * @param {string} message - JSON-serialized message payload
 */
global.broadcastToRoom = (roomUuid, message) => {
  wss.clients.forEach(client => {
    if (client.roomUuid === roomUuid && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

/**
 * Broadcasts updated participant list with current roles and avatar colors to all room clients (FR-44).
 *
 * @async
 * @function broadcastRoomParticipants
 * @param {string} roomUuid - Target room UUID
 * @returns {Promise<void>}
 */
global.broadcastRoomParticipants = async (roomUuid) => {
  try {
    const room = await Room.findOne({ uuid: roomUuid }).populate('participants.user', 'displayName email avatarColor');
    if (!room) return;

    const payload = JSON.stringify({
      type: 'participants_update',
      participants: room.participants.map(p => ({
        userId: p.user._id,
        displayName: p.user.displayName,
        avatarColor: p.user.avatarColor,
        role: p.role,
      })),
    });

    wss.clients.forEach(client => {
      if (client.roomUuid === roomUuid && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  } catch (err) {
    logger.error('Error broadcasting participants: ' + err.message, { roomId: roomUuid });
  }
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

  // Max room capacity check (NFR-36)
  const maxLimit = getMaxWsPerRoom();
  const currentRoomConnections = getRoomConnectionCount(roomUuid, ws);

  if (currentRoomConnections >= maxLimit) {
    const errorMsg = `Room capacity exceeded (maximum ${maxLimit} connections per room).`;
    console.log(`[!] Room ${roomUuid} capacity exceeded (${currentRoomConnections}/${maxLimit}). Rejecting connection for user "${user.displayName}".`);

    // Ensure ws is not tagged as occupying a room slot
    ws.roomUuid = null;
    ws.userId = null;
    ws.role = null;

    try {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'ROOM_CAPACITY_EXCEEDED',
        message: errorMsg,
        limit: maxLimit,
        current: currentRoomConnections,
      }));
    } catch (err) {
      // Socket already closed
    }

    // RFC 6455 Close Code 1008: Policy Violation
    ws.close(1008, errorMsg);
    return;
  }

  ws.roomUuid = roomUuid;
  ws.userId = user._id.toString();
  ws.role = role;

  logger.info('Collaborator connected to workspace', { userId: user._id, roomId: roomUuid, role });

  // FR-14: record user presence
  touchRoomActivity(roomUuid);

  // Security: Max room capacity check prevents socket exhaustion attacks (NFR-36)
  let roomCount = 0;
  wss.clients.forEach(client => {
    if (client.roomUuid === roomUuid) roomCount++;
  });

  if (roomCount > 20) {
    logger.warn('Room capacity exceeded (max 20 clients)', { userId: user._id, roomId: roomUuid });
    ws.send(JSON.stringify({ type: 'error', message: 'Room capacity exceeded (max 20 clients).' }));
    ws.close();
    return;
  }

  // Load / Initialize Y.Doc
  const docState = await getOrCreateYdoc(roomUuid);
  const ydoc = docState.ydoc;

  // Protocol: Emit Sync Step 1 to trigger state synchronization with the joining client
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync = 0
  syncProtocol.writeSyncStep1(encoder, ydoc);
  ws.send(encoding.toUint8Array(encoder));

  // Handle incoming WebSocket messages
  ws.on('message', (data, isBinary) => {
    try {
      if (!isBinary) {
        // Text control frames reserved for future extensions
        return;
      }

      // Isolate clean Uint8Array to avoid Node.js Buffer memory pool offset alignment corruption
      const cleanData = new Uint8Array(data.length);
      cleanData.set(data);

      // ─── ROLE ENFORCEMENT & WRITE BARRIER (NFR-18) ──────────────────────────
      // Security: Intercept and inspect binary updates if the sender is a Viewer
      if (ws.role === 'Viewer') {
        const isWrite = cleanData && cleanData.length > 1 && cleanData[0] === 0 && (cleanData[1] === 1 || cleanData[1] === 2);
        if (isWrite) {
          try {
            const decoding = require('lib0/decoding');
            const Y = require('yjs');
            const decoder = decoding.createDecoder(cleanData);
            decoding.readVarUint(decoder); // skip messageSync (0)
            const msgType = decoding.readVarUint(decoder);
            
            // Check if frame contains document updates (Step 2 or incremental Update)
            if (msgType === 1 || msgType === 2) {
              const extractedUpdate = decoding.readVarUint8Array(decoder);
              const decoded = Y.decodeUpdate(extractedUpdate);
              
              // Security: Check if any CRDT operation modifies code file text (anything not ending with ':chat')
              const isEditingFile = decoded.structs.some(struct => {
                const parent = struct.parent;
                return typeof parent === 'string' && !parent.endsWith(':chat');
              });
              
              if (isEditingFile) {
                // Security: Drop file mutation updates silently. Viewers are forbidden from modifying files!
                return;
              }
            } else {
              // Security: Drop all other sync write subtypes for Viewers
              return;
            }
          } catch (err) {
            logger.error('Error parsing Viewer write check: ' + err.message, { userId: ws.userId, roomId: roomUuid });
            return; // Security fallback: drop frame on parse failure to prevent malformed binary exploits
          }
        }
      }

      // Protocol: Apply Yjs updates to server-side document
      if (cleanData[0] === 0) {
        const decoder = decoding.createDecoder(cleanData);
        decoding.readVarUint(decoder); // skip messageSync (0)
        
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        
        // This triggers debounced database persistence via the 'update' event
        syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);
        
        // If the server produced a sync response (e.g. Step 2 update), send it back to the client
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      }

      // Protocol & Security: Relay binary frame strictly to other clients in the same room (NFR-52)
      wss.clients.forEach(client => {
        if (
          client !== ws &&
          client.roomUuid === roomUuid &&
          client.readyState === WebSocket.OPEN
        ) {
          client.send(data, { binary: isBinary });
        }
      });
    } catch (err) {
      logger.error('Error processing ws message: ' + err.message, { userId: ws.userId, roomId: roomUuid });
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    logger.info('Collaborator disconnected from workspace', { userId: user._id, roomId: roomUuid });

    // FR-14: record timestamp of departure
    touchRoomActivity(roomUuid);

    // Check if room is empty (NFR-36 / NFR-37)
    const activeCount = getRoomConnectionCount(roomUuid, ws);

    // Unload empty rooms from RAM to prevent memory leaks (NFR-38)
    if (activeCount === 0) {
      logger.info('Room is inactive. Performing final save and unloading...', { roomId: roomUuid });
      const state = activeDocs.get(roomUuid);
      if (state) {
        if (state.saveTimer) {
          clearTimeout(state.saveTimer);
        }
        saveRoomStateToDB(roomUuid, state.ydoc)
          .then(() => {
            activeDocs.delete(roomUuid);
            logger.info('Unloaded room from server memory', { roomId: roomUuid });
          })
          .catch(err => {
            logger.error('Final save error on unload: ' + err.message, { roomId: roomUuid });
          });
      }
    }
  });

  ws.on('error', (err) => {
    logger.error('WS error: ' + err.message, { userId: ws.userId, roomId: ws.roomUuid });
  });
});

// PM2 & Container Graceful Shutdown (NFR-38)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Handles graceful process termination on SIGTERM/SIGINT signals (NFR-38).
 * Flushes all pending in-memory Yjs documents to MongoDB before terminating
 * Express and WebSocket servers, preventing data loss during rolling deployments.
 *
 * @async
 * @function gracefulShutdown
 * @returns {Promise<void>}
 */
async function gracefulShutdown() {
  console.log('\n🛑 SIGTERM/SIGINT received. Commencing graceful shutdown...');
  
  // Persist all active documents in memory to MongoDB
  const savePromises = [];
  activeDocs.forEach((state, roomUuid) => {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    persistencePromises.push(
      saveRoomStateToDB(roomUuid, state.ydoc)
        .then(() => {
          pendingRooms.delete(roomUuid);
        })
        .catch((err) => {
          console.error(`❌ Error persisting room ${roomUuid} during shutdown:`, err.message);
        })
    );
  });

  // Await persistence across all rooms (Promise.allSettled guarantees no room is abandoned)
  await Promise.allSettled(persistencePromises);
  console.log(`💾 Yjs persistence complete. Remaining unpersisted rooms: ${pendingRooms.size}`);
  activeDocs.clear();

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

  // 7. Clear watchdog and exit cleanly
  clearTimeout(watchdog);
  console.log('✅ Graceful shutdown completed cleanly. Exiting process.\n');
  process.exit(0);
}

if (require.main === module) {
  connectDB();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n✅  Collide Backend → http://localhost:${PORT}`);
    console.log(`⚡  JWT Asymmetric signatures initialized.\n`);
  });
}

module.exports = { app, server, connectDB };

