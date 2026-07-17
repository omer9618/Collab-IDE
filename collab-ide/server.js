require('dotenv').config();
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

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO Server for Voice Signalling
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

// Global Middlewares
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Static Client Files
app.use(express.static(path.join(__dirname, 'public')));

// Register REST Routes
app.use('/api/auth',      authRoutes);
app.use('/api/rooms',     roomRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/voice',     voiceRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Health Check Endpoint (NFR-39)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    activeRooms: activeDocs.size,
  });
});

// Initialize WebSocket Server
const wss = new WebSocket.Server({ noServer: true });

// roomUuid -> { ydoc: Y.Doc, saveTimer: Timeout }
const activeDocs = new Map();

// Save room document state to MongoDB
async function saveRoomStateToDB(roomUuid, ydoc) {
  try {
    const room = await Room.findOne({ uuid: roomUuid });
    if (!room) return;

    // Extract files list from Yjs shared files array (dynamic source of truth)
    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    const fileNames = yfiles.length > 0 ? yfiles.toArray() : room.files.map(f => f.name);

    const updatedFiles = fileNames.map(name => {
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
          ydocState: ydocStateBuffer
        } 
      }
    );
    console.log(`💾 Persisted room ${roomUuid} state to MongoDB`);
  } catch (err) {
    console.error(`❌ Error saving room ${roomUuid} to DB:`, err);
  }
}

// Debounce schedule save (NFR-26)
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

// Retrieve or load Y.Doc state
async function getOrCreateYdoc(roomUuid) {
  if (activeDocs.has(roomUuid)) {
    return activeDocs.get(roomUuid);
  }

  const room = await Room.findOne({ uuid: roomUuid });
  const ydoc = new Y.Doc();

  if (room) {
    if (room.ydocState) {
      // Restore Yjs document using the binary state update snapshot to preserve clocks and client IDs
      Y.applyUpdate(ydoc, room.ydocState);
    } else if (room.files) {
      // Fallback for legacy rooms or first-time load: populate via text insert
      const yfiles = ydoc.getArray(`${roomUuid}:files`);
      const fileNames = room.files.map(f => f.name);
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

// Atomic update of user roles in memory (NFR-19)
global.updateClientRoleInMemory = (roomUuid, userId, newRole) => {
  wss.clients.forEach(client => {
    if (client.roomUuid === roomUuid && client.userId === userId.toString()) {
      client.role = newRole;
      try {
        client.send(JSON.stringify({ type: 'role_update', role: newRole }));
      } catch (err) {
        console.error('Error sending role update to client:', err);
      }
      console.log(`🔒 Updated role in memory: User ${userId} is now ${newRole} in ${roomUuid}`);
    }
  });
};

/**
 * Broadcast a raw text JSON string to every open WebSocket in a given room.
 * Used by the execution route to push exec:result frames (FR-29).
 * @param {string} roomUuid
 * @param {string} message - JSON string
 */
global.broadcastToRoom = (roomUuid, message) => {
  wss.clients.forEach(client => {
    if (client.roomUuid === roomUuid && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// Broadcast participants list update (FR-44)
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
    console.error('❌ Error broadcasting participants:', err);
  }
};

// HTTP Upgrade Handshake Auth Enforcer (NFR-17 / NFR-25)
server.on('upgrade', async (request, socket, head) => {
  try {
    const parsedUrl = new URL(request.url, 'http://localhost');
    
    // Ignore socket.io upgrade requests to prevent conflicts (let socket.io handle its own upgrades)
    if (parsedUrl.pathname.startsWith('/socket.io')) {
      return;
    }

    const roomUuid = parsedUrl.pathname.slice(1);
    const token = parsedUrl.searchParams.get('token');

    if (!token) {
      console.log('❌ Upgrade Rejected: No token provided');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify JWT
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      console.log('❌ Upgrade Rejected: User not found');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify Room & Membership
    const room = await Room.findOne({ uuid: roomUuid });
    if (!room) {
      console.log(`❌ Upgrade Rejected: Room ${roomUuid} not found`);
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const participant = room.participants.find(p => p.user.toString() === user._id.toString());
    if (!participant) {
      console.log(`❌ Upgrade Rejected: User ${user.displayName} is not a member of room ${roomUuid}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Inject metadata into request object for WebSocket connection handling
    request.user = user;
    request.role = participant.role;
    request.roomUuid = roomUuid;

    // Proceed to establish WebSocket connection
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } catch (error) {
    console.log('❌ Upgrade Rejected: Invalid or expired token', error.message);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

wss.on('connection', async (ws, req) => {
  const roomUuid = req.roomUuid;
  const user = req.user;
  const role = req.role;

  ws.roomUuid = roomUuid;
  ws.userId = user._id.toString();
  ws.role = role;

  console.log(`[+] "${roomUuid}" — User "${user.displayName}" (${role}) connected`);

  // Max room capacity check (NFR-36)
  let roomCount = 0;
  wss.clients.forEach(client => {
    if (client.roomUuid === roomUuid) roomCount++;
  });

  if (roomCount > 20) {
    console.log(`[!] Room ${roomUuid} capacity exceeded. Rejecting connection.`);
    ws.send(JSON.stringify({ type: 'error', message: 'Room capacity exceeded (max 20 clients).' }));
    ws.close();
    return;
  }

  // Load / Initialize Y.Doc
  const docState = await getOrCreateYdoc(roomUuid);
  const ydoc = docState.ydoc;

  // Send Sync Step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync = 0
  syncProtocol.writeSyncStep1(encoder, ydoc);
  ws.send(encoding.toUint8Array(encoder));

  ws.on('message', (data, isBinary) => {
    try {
      if (!isBinary) {
        // Handle text message if needed
        return;
      }

      // Convert Node Buffer to a clean, isolated Uint8Array to avoid lib0 DataView offset alignment bugs
      const cleanData = new Uint8Array(data.length);
      cleanData.set(data);

      // Check Viewer role write block (NFR-18)
      if (ws.role === 'Viewer') {
        const isWrite = cleanData && cleanData.length > 1 && cleanData[0] === 0 && (cleanData[1] === 1 || cleanData[1] === 2);
        if (isWrite) {
          try {
            const decoding = require('lib0/decoding');
            const Y = require('yjs');
            const decoder = decoding.createDecoder(cleanData);
            decoding.readVarUint(decoder); // skip messageSync (0)
            const msgType = decoding.readVarUint(decoder);
            if (msgType === 1 || msgType === 2) {
              const extractedUpdate = decoding.readVarUint8Array(decoder);
              const decoded = Y.decodeUpdate(extractedUpdate);
              
              // Check if any struct in the update is modifying a text document (anything not ending with ':chat')
              const isEditingFile = decoded.structs.some(struct => {
                const parent = struct.parent;
                return typeof parent === 'string' && !parent.endsWith(':chat');
              });
              
              if (isEditingFile) {
                // Drop file edits silently, but allow chat messages!
                return;
              }
            } else {
              // Drop other sync write types for Viewers
              return;
            }
          } catch (err) {
            console.error('Error parsing Viewer write check:', err);
            return; // Safety fallback: block on error
          }
        }
      }

      // Apply Yjs updates to server-side document
      if (cleanData[0] === 0) {
        const decoder = decoding.createDecoder(cleanData);
        decoding.readVarUint(decoder); // skip messageSync (0)
        
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        
        // This will trigger database update debounced via the 'update' event
        syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);
        
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      }

      // Relay binary frame to all other connections in the same room
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
      console.error('❌ Error processing ws message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[-] "${roomUuid}" — User "${user.displayName}" disconnected`);
    
    // Check if room is empty
    let activeCount = 0;
    wss.clients.forEach(client => {
      if (client.roomUuid === roomUuid) activeCount++;
    });

    if (activeCount === 0) {
      console.log(`🧹 Room ${roomUuid} is inactive. Performing final save and unloading...`);
      const state = activeDocs.get(roomUuid);
      if (state) {
        if (state.saveTimer) {
          clearTimeout(state.saveTimer);
        }
        saveRoomStateToDB(roomUuid, state.ydoc)
          .then(() => {
            activeDocs.delete(roomUuid);
            console.log(`🧹 Unloaded room ${roomUuid} from server memory.`);
          })
          .catch(err => {
            console.error(`❌ Final save error on unload for room ${roomUuid}:`, err);
          });
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`❌ WS error:`, err.message);
  });
});

// PM2 Graceful Shutdown support (NFR-38)
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  console.log('\n🛑 SIGTERM/SIGINT received. Commencing graceful shutdown...');
  
  // Persist all active documents in memory to MongoDB
  const savePromises = [];
  activeDocs.forEach((state, roomUuid) => {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    savePromises.push(saveRoomStateToDB(roomUuid, state.ydoc));
  });

  await Promise.all(savePromises);
  console.log('💾 All active room states persisted.');
  
  server.close(() => {
    console.log('🚪 Express Server closed. Exiting process.\n');
    process.exit(0);
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅  CollabIDE Backend → http://localhost:${PORT}`);
  console.log(`⚡  JWT Asymmetric signatures initialized.\n`);
});
