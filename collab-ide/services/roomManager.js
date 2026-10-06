/**
 * @file services/roomManager.js
 * @module services/roomManager
 * @description Room Isolation Engine and Yjs CRDT / WebSocket Session Manager (NFR-52).
 *
 * Implements NFR-52 (Room Isolation):
 * "A crash or resource spike in one room must not affect other rooms.
 * Each room's Yjs document and WebSocket client set must be independently managed."
 *
 * SECURITY & ARCHITECTURAL HIGHLIGHTS:
 * 1. Independent WebSocket Client Sets:
 *    Each room maintains an encapsulated, isolated `Set<WebSocket>`. Relaying, broadcasting,
 *    and presence tracking operate exclusively over the room's client set, preventing cross-room
 *    iteration leaks and resource interference.
 * 2. Independent Yjs Document Management:
 *    Each room owns its own `Y.Doc` CRDT model. Unloading a room performs a clean persistence to
 *    MongoDB and invokes `ydoc.destroy()` to reclaim memory, listeners, and awareness structures.
 * 3. Fault Tolerance & Room Crash Containment:
 *    All frame decoding, write barrier checks, CRDT updates, and relays are guarded by an
 *    isolated room-level error boundary. Corrupted payloads or exceptions in Room A are caught,
 *    logged, and dropped without crashing the Node.js process or degrading Room B.
 * 4. Resource Spike Containment:
 *    - Message Rate Limiter (Token Bucket / Sliding Window): Enforces max 100 messages/sec per client.
 *      Excess messages are dropped, and extreme flooders are severed (close code 1008).
 *    - Payload Size Capping: Frames exceeding 5MB are rejected to protect server heap memory.
 *    - Safe Socket Transmission (`safeSend`): Protects against broken pipe / ECONNRESET socket crashes.
 * 5. Debounced Persistence Isolation:
 *    Each room manages an independent 2000ms debounced persistence timer. Slow or delayed database
 *    operations in Room A never stall or delay persistence in Room B.
 */

const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const WebSocket = require('ws');
const Room = require('../models/Room');
const logger = require('../utils/logger');

// Maximum payload size per WebSocket frame (512KB) to prevent memory allocation spikes
const MAX_WS_FRAME_BYTES = 512 * 1024;

// Maximum messages per second per WebSocket client to prevent CPU / event loop spikes
const MAX_MSGS_PER_SEC_PER_CLIENT = 300;
const FLOOD_THRESHOLD_PER_SEC = 1000;

/**
 * Persists live in-memory Yjs document state and files to MongoDB (NFR-26, NFR-52).
 *
 * @async
 * @function saveRoomStateToDB
 * @param {string} roomUuid - Target room UUID
 * @param {Y.Doc} ydoc - In-memory Yjs CRDT document
 * @returns {Promise<void>}
 */
async function saveRoomStateToDB(roomUuid, ydoc) {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return;
    }

    if (process.env.TEST_SIMULATE_SLOW_ROOM && roomUuid.includes(process.env.TEST_SIMULATE_SLOW_ROOM)) {
      const delay = parseInt(process.env.TEST_PERSISTENCE_DELAY_MS, 10) || 30000;
      console.log(`[TEST HOOK] Artificially delaying persistence of room ${roomUuid} for ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const room = await Room.findOne({ uuid: roomUuid });
    if (!room) return;

    // Extract files list from Yjs shared files array
    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    const fileNames = yfiles.length > 0 ? yfiles.toArray() : (room.files || []).map((f) => f.name);
    const uniqueFileNames = Array.from(new Set(fileNames));

    const updatedFiles = uniqueFileNames.map((name) => {
      const ytext = ydoc.getText(`${roomUuid}:${name}`);
      return {
        name,
        content: ytext.toString(),
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
          lastActiveAt: new Date(),
        },
      }
    );
    logger.info('Persisted room state to MongoDB', { roomId: roomUuid });
  } catch (err) {
    logger.error('Error saving room state to DB: ' + err.message, { roomId: roomUuid });
  }
}

/**
 * Isolated Room Session representing a single collaborative workspace.
 * Encapsulates its own Yjs document, independent WebSocket client set,
 * rate limiting state, error metrics, and persistence timer.
 */
class RoomSession {
  /**
   * @constructor
   * @param {string} roomUuid - UUID identifier of the room
   * @param {Y.Doc} ydoc - Room's independent Yjs document
   * @param {object} [options={}] - Optional configuration including pubsubAdapter and nodeId (NFR-53)
   */
  constructor(roomUuid, ydoc = null, options = {}) {
    this.roomUuid = roomUuid;
    this.ydoc = ydoc || new Y.Doc();
    
    // NFR-52: Independent WebSocket client set strictly scoped to this room
    this.clients = new Set();

    // NFR-53: Distributed Pub/Sub Adapter & Horizontal Scaling Readiness
    this.pubsubAdapter = options.pubsubAdapter || null;
    this.nodeId = options.nodeId || 'default_node';
    this.pubsubChannel = `collab:room:${roomUuid}`;
    this._pubsubHandler = (channel, msg) => this.handlePubSubMessage(channel, msg);

    if (this.pubsubAdapter && typeof this.pubsubAdapter.subscribe === 'function') {
      this.pubsubAdapter.subscribe(this.pubsubChannel, this._pubsubHandler);
    }

    // Debounced persistence state
    this.saveTimer = null;
    this.isSaving = false;
    this.lastSaveTime = Date.now();

    // Room-level diagnostics & telemetry
    this.createdAt = new Date();
    this.lastActiveAt = new Date();
    this.messageCount = 0;
    this.bytesReceived = 0;
    this.errorCount = 0;
    this.rateLimitDrops = 0;
    this.isDestroyed = false;

    // Per-client rate limit tracking (WeakMap ensures automatic GC on client disconnect)
    this.clientRateMap = new WeakMap();

    // Auto-save on document modification
    this.ydoc.on('update', () => {
      this.scheduleSave();
    });
  }

  /**
   * Dynamically configures or updates the Pub/Sub adapter for this room session (NFR-53).
   *
   * @param {import('./pubsub').PubSubAdapter|null} adapter
   */
  setPubSubAdapter(adapter) {
    if (this.pubsubAdapter && this._pubsubHandler && typeof this.pubsubAdapter.unsubscribe === 'function') {
      try {
        this.pubsubAdapter.unsubscribe(this.pubsubChannel, this._pubsubHandler);
      } catch (_) {}
    }
    this.pubsubAdapter = adapter || null;
    if (this.pubsubAdapter && this._pubsubHandler && !this.isDestroyed && typeof this.pubsubAdapter.subscribe === 'function') {
      this.pubsubAdapter.subscribe(this.pubsubChannel, this._pubsubHandler);
    }
  }

  /**
   * Processes distributed room messages received via the Pub/Sub adapter (NFR-53).
   * Routes cross-node CRDT edits, broadcasts, role mutations, and presence without single-process limits.
   *
   * @param {string} channel - Channel name
   * @param {object} msg - Deserialized pub/sub payload
   */
  handlePubSubMessage(channel, msg) {
    if (this.isDestroyed || !msg) return;
    if (msg.originNodeId === this.nodeId) return; // Drop echo loop from self

    if (msg.type === 'yjs_update' && msg.payload) {
      let updateBytes;
      if (msg.payload.__binary && msg.payload.data) {
        updateBytes = Buffer.from(msg.payload.data, 'base64');
      } else if (msg.payload instanceof Uint8Array || Buffer.isBuffer(msg.payload)) {
        updateBytes = new Uint8Array(msg.payload);
      } else if (typeof msg.payload === 'object') {
        updateBytes = new Uint8Array(Object.values(msg.payload));
      }
      if (updateBytes && updateBytes.length > 0) {
        try {
          if (updateBytes[0] === 0) {
            // Decodes Yjs syncProtocol binary message (messageSync = 0)
            const decoder = decoding.createDecoder(updateBytes);
            decoding.readVarUint(decoder); // skip messageSync (0)
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 0);
            syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, 'pubsub');
          } else {
            // Raw Yjs update
            Y.applyUpdate(this.ydoc, updateBytes, 'pubsub');
          }
          // Relay binary update to local connected clients
          this.relay(null, updateBytes, true);
        } catch (err) {
          logger.error('Error applying pubsub Yjs update: ' + err.message, { roomId: this.roomUuid });
        }
      }
    } else if (msg.type === 'broadcast_text') {
      this.broadcastText(msg.payload);
    } else if (msg.type === 'role_update') {
      this.updateUserRole(msg.userId, msg.newRole);
    } else if (msg.type === 'participants_update' && msg.payload) {
      this.broadcastText(msg.payload);
    }
  }

  /**
   * Adds an authenticated WebSocket client to this room's isolated client set.
   *
   * @param {WebSocket} ws - Client WebSocket instance
   * @param {object} user - User document
   * @param {string} role - User role in room
   */
  addClient(ws, user, role) {
    ws.roomUuid = this.roomUuid;
    ws.userId = user._id.toString();
    ws.role = role;
    ws.isAlive = true;

    this.clients.add(ws);
    this.touchActivity();
  }

  /**
   * Removes a WebSocket client from this room's client set.
   *
   * @param {WebSocket} ws - Client WebSocket instance
   * @returns {number} Remaining active client count in this room
   */
  removeClient(ws) {
    this.clients.delete(ws);
    this.touchActivity();
    return this.getConnectionCount();
  }

  /**
   * Gets the count of connected or connecting clients in this room.
   *
   * @param {WebSocket|null} [excludeWs=null] - Optional socket to exclude from count
   * @returns {number} Active connection count
   */
  getConnectionCount(excludeWs = null) {
    let count = 0;
    for (const client of this.clients) {
      if (
        client !== excludeWs &&
        (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING)
      ) {
        count++;
      }
    }
    return count;
  }

  /**
   * Updates last activity timestamp.
   */
  touchActivity() {
    this.lastActiveAt = new Date();
  }

  /**
   * Safely transmits data to a WebSocket client with comprehensive error trapping.
   * Prevents broken pipe or disconnected socket errors from crashing the room or server.
   *
   * @param {WebSocket} ws - Destination WebSocket
   * @param {string|Buffer|Uint8Array} data - Payload
   * @param {boolean} [isBinary=false] - Whether payload is binary
   * @returns {boolean} Whether transmission succeeded
   */
  safeSend(ws, data, isBinary = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(data, { binary: isBinary });
      return true;
    } catch (err) {
      logger.error('Safe send error: ' + err.message, {
        roomId: this.roomUuid,
        userId: ws.userId,
      });
      // Remove dead socket from room set to prevent repeated failures
      this.clients.delete(ws);
      try {
        ws.terminate();
      } catch (termErr) {
        // Socket already closed
      }
      return false;
    }
  }

  /**
   * Relays data strictly to other clients within this room's client set.
   * NFR-52: Never loops over clients from any other room.
   *
   * @param {WebSocket} senderWs - Source WebSocket to exclude from relay
   * @param {string|Buffer|Uint8Array} data - Payload to relay
   * @param {boolean} [isBinary=false] - Whether payload is binary
   */
  relay(senderWs, data, isBinary = false) {
    for (const client of this.clients) {
      if (client !== senderWs && client.readyState === WebSocket.OPEN) {
        this.safeSend(client, data, isBinary);
      }
    }
  }

  /**
   * Broadcasts a text control message (e.g. JSON) to all connected clients in this room.
   *
   * @param {string} message - JSON string to broadcast
   */
  broadcastText(message) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        this.safeSend(client, message, false);
      }
    }
  }

  /**
   * Dynamically updates a user's role across all their active WebSockets in this room (NFR-19).
   *
   * @param {string} userId - User ID to update
   * @param {string} newRole - New role ('Owner' | 'Room Leader' | 'Editor' | 'Viewer')
   */
  updateUserRole(userId, newRole) {
    const targetId = userId.toString();
    for (const client of this.clients) {
      if (client.userId === targetId) {
        client.role = newRole;
        this.safeSend(client, JSON.stringify({ type: 'role_update', role: newRole }));
        logger.audit('ROLE_UPDATED', { userId: targetId, roomId: this.roomUuid, newRole });
      }
    }
  }

  /**
   * Enforces per-client message rate limiting to prevent resource starvation (NFR-52).
   *
   * @param {WebSocket} ws - Incoming WebSocket client
   * @returns {boolean} True if allowed; false if throttled/dropped
   */
  checkRateLimit(ws) {
    if (ws._rateLimitKilled) {
      return false;
    }

    const now = Date.now();
    let clientRate = this.clientRateMap.get(ws);

    if (!clientRate || now - clientRate.windowStart > 1000) {
      clientRate = { count: 1, windowStart: now };
      this.clientRateMap.set(ws, clientRate);
      return true;
    }

    clientRate.count++;

    // Extreme flooding threshold: terminate offending socket immediately
    if (clientRate.count > FLOOD_THRESHOLD_PER_SEC) {
      ws._rateLimitKilled = true;
      logger.warn('Client terminated due to extreme message flood', {
        roomId: this.roomUuid,
        userId: ws.userId,
        rate: clientRate.count,
      });
      this.clients.delete(ws);
      try {
        ws.close(1008, 'Message rate limit exceeded.');
      } catch (e) {
        // ignore
      }
      try {
        ws.terminate();
      } catch (e) {
        // ignore
      }
      return false;
    }

    // Rate limit drop threshold
    if (clientRate.count > MAX_MSGS_PER_SEC_PER_CLIENT) {
      this.rateLimitDrops++;
      if (clientRate.count === MAX_MSGS_PER_SEC_PER_CLIENT + 1) {
        logger.warn('Client message rate limit exceeded; throttling frames', {
          roomId: this.roomUuid,
          userId: ws.userId,
        });
      }
      return false;
    }

    return true;
  }

  /**
   * Room Message Processing Boundary (NFR-18, NFR-52).
   * Traps all errors and prevents any room crash or resource spike from leaking outward.
   *
   * @param {WebSocket} ws - Source WebSocket
   * @param {Buffer|ArrayBuffer|Buffer[]} rawData - Message data
   * @param {boolean} isBinary - Whether message is binary
   */
  handleMessage(ws, rawData, isBinary) {
    try {
      this.messageCount++;
      const dataLength = rawData ? (rawData.length || rawData.byteLength || 0) : 0;
      this.bytesReceived += dataLength;
      this.touchActivity();

      // Non-binary frames reserved for future text control messages
      if (!isBinary) {
        return;
      }

      // ─── 1. PAYLOAD SIZE SPIKE PROTECTION (NFR-52) ──────────────────────────
      if (dataLength > MAX_WS_FRAME_BYTES) {
        logger.warn('Rejected oversized WebSocket frame', {
          roomId: this.roomUuid,
          userId: ws.userId,
          bytes: dataLength,
          limit: MAX_WS_FRAME_BYTES,
        });
        this.safeSend(
          ws,
          JSON.stringify({
            type: 'error',
            code: 'FRAME_TOO_LARGE',
            message: 'Message payload exceeds maximum allowable size (512KB).',
          })
        );
        return;
      }

      // ─── 2. CPU / MESSAGE RATE SPIKE PROTECTION (NFR-52) ───────────────────
      if (!this.checkRateLimit(ws)) {
        return;
      }

      // Clean memory slice to prevent Node.js Buffer pool alignment corruption
      const cleanData = new Uint8Array(dataLength);
      cleanData.set(rawData);

      // ─── 3. VIEWER ROLE WRITE BARRIER (NFR-18) ─────────────────────────────
      if (ws.role === 'Viewer') {
        const isWrite =
          cleanData &&
          cleanData.length > 1 &&
          cleanData[0] === 0 &&
          (cleanData[1] === 1 || cleanData[1] === 2);

        if (isWrite) {
          try {
            const decoder = decoding.createDecoder(cleanData);
            decoding.readVarUint(decoder); // skip messageSync (0)
            const msgType = decoding.readVarUint(decoder);

            if (msgType === 1 || msgType === 2) {
              const extractedUpdate = decoding.readVarUint8Array(decoder);
              const decoded = Y.decodeUpdate(extractedUpdate);

              // Allow chat messages, drop file mutations
              const isEditingFile = decoded.structs.some((struct) => {
                const parent = struct.parent;
                return typeof parent === 'string' && !parent.endsWith(':chat');
              });

              if (isEditingFile) {
                // Drop write silently for Viewers
                return;
              }
            } else {
              return;
            }
          } catch (err) {
            logger.error('Error parsing Viewer write check: ' + err.message, {
              userId: ws.userId,
              roomId: this.roomUuid,
            });
            return;
          }
        }
      }

      // ─── 4. CRDT DOCUMENT UPDATE & RELAY ───────────────────────────────────
      if (cleanData[0] === 0) {
        const decoder = decoding.createDecoder(cleanData);
        decoding.readVarUint(decoder); // skip messageSync (0)

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);

        // Reads sync message and applies to this room's Y.Doc (triggers debounced save)
        syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, ws);

        // If server produced a reply (e.g. SyncStep2 response), send back to requester
        if (encoding.length(encoder) > 1) {
          this.safeSend(ws, encoding.toUint8Array(encoder), true);
        }
      }

      // Relay frame strictly within this room's client set (NFR-52)
      this.relay(ws, rawData, isBinary);

      // NFR-53: Publish collaborative update to all cluster nodes via Pub/Sub adapter
      if (this.pubsubAdapter && cleanData && cleanData.length > 0) {
        this.pubsubAdapter.publish(this.pubsubChannel, {
          originNodeId: this.nodeId,
          type: 'yjs_update',
          payload: cleanData,
        });
      }
    } catch (err) {
      this.errorCount++;
      logger.error('Room message processing error (contained): ' + err.message, {
        roomId: this.roomUuid,
        userId: ws?.userId,
        error: err.stack,
      });

      // Transmit error feedback to offending socket without crashing room or server
      this.safeSend(
        ws,
        JSON.stringify({
          type: 'error',
          code: 'SYNC_PROCESSING_ERROR',
          message: 'Unable to process collaborative update. Please try again.',
        })
      );
    }
  }

  /**
   * Schedules a debounced database write for this room document (NFR-26).
   * Incorporates a max-wait throttle to prevent starvation if activity is continuous (NFR-08).
   */
  scheduleSave() {
    if (this.isDestroyed) return;

    const now = Date.now();
    
    // Force a save if 10 seconds have passed since the last save, even if activity never stops
    if (now - this.lastSaveTime > 10000 && !this.isSaving) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveToDB();
      return;
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      if (!this.isSaving) this.saveToDB();
    }, 2000);
  }

  /**
   * Persists this room's current state to MongoDB.
   *
   * @async
   * @returns {Promise<void>}
   */
  async saveToDB() {
    if (this.isDestroyed || this.isSaving) return;
    this.isSaving = true;
    try {
      await saveRoomStateToDB(this.roomUuid, this.ydoc);
      this.lastSaveTime = Date.now();
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Cleanly destroys this room session, purging clients and reclaiming Yjs CRDT memory.
   *
   * @async
   * @returns {Promise<void>}
   */
  async destroy(skipPersistence = false) {
    this.isDestroyed = true;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // Perform final state persistence unless explicitly skipped (e.g. unit tests)
    if (!skipPersistence && this.ydoc) {
      try {
        await saveRoomStateToDB(this.roomUuid, this.ydoc);
      } catch (err) {
        logger.error('Final save error on room destroy: ' + err.message, { roomId: this.roomUuid });
      }
    }

    // Close any remaining sockets in this room
    for (const client of this.clients) {
      try {
        client.close(1001, 'Room session ended.');
      } catch (e) {
        // Socket closed
      }
    }
    this.clients.clear();

    // Unsubscribe from Pub/Sub channel (NFR-53)
    if (this.pubsubAdapter && this._pubsubHandler && typeof this.pubsubAdapter.unsubscribe === 'function') {
      try {
        this.pubsubAdapter.unsubscribe(this.pubsubChannel, this._pubsubHandler);
      } catch (_) {}
    }

    // Free Yjs CRDT document structures and awareness handlers
    try {
      if (this.ydoc) {
        this.ydoc.destroy();
        this.ydoc = null;
      }
    } catch (err) {
      logger.error('Error destroying Y.Doc: ' + err.message, { roomId: this.roomUuid });
    }
  }
}

/**
 * RoomManager: Global Singleton managing isolated RoomSession instances.
 */
class RoomManager {
  constructor(options = {}) {
    /**
     * Active room registry mapping roomUuid -> RoomSession.
     * @type {Map<string, RoomSession>}
     */
    this.rooms = new Map();

    // NFR-53: Horizontal Scaling Readiness
    this.nodeId = options.nodeId || process.env.NODE_ID || 'node_' + Math.random().toString(36).substring(2, 9);
    this.pubsubAdapter = options.pubsubAdapter || null;

    // NFR-37: Memory-Efficient Yjs Document Management
    // Sweep for inactive rooms (no connected clients for > 30 mins)
    this.inactiveRoomSweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [roomUuid, session] of this.rooms.entries()) {
        if (session.clients.size === 0 && (now - session.lastActiveAt.getTime() >= 30 * 60 * 1000)) {
          this.unloadRoom(roomUuid).catch(err => {
            logger.error('Error unloading inactive room: ' + err.message, { roomId: roomUuid });
          });
        }
      }
    }, 60 * 1000); // Check every minute
  }

  /**
   * Sets or replaces the Pub/Sub adapter across all active rooms (NFR-53).
   *
   * @param {import('./pubsub').PubSubAdapter|null} adapter
   */
  setPubSubAdapter(adapter) {
    this.pubsubAdapter = adapter || null;
    for (const session of this.rooms.values()) {
      session.setPubSubAdapter(this.pubsubAdapter);
    }
  }

  /**
   * Retrieves an existing RoomSession or loads and hydrates one from MongoDB.
   *
   * @async
   * @param {string} roomUuid - Target room UUID
   * @returns {Promise<RoomSession>}
   */
  async getOrCreateRoom(roomUuid) {
    let session = this.rooms.get(roomUuid);
    
    // If a session is currently being destroyed (e.g. from a recent disconnect),
    // wait for it to finish and be removed from the map so we don't connect to a dying session.
    if (session && session.isDestroyed) {
      while (this.rooms.has(roomUuid)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      session = null;
    }

    if (session) {
      return session;
    }

    let room = null;
    const mongoose = require('mongoose');
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        room = await Room.findOne({ uuid: roomUuid });
      } catch (err) {
        // Fall back gracefully to empty room on database failure
      }
    }
    const ydoc = new Y.Doc();

    if (room) {
      if (room.ydocState) {
        try {
          // room.ydocState is a Node.js Buffer (which extends Uint8Array)
          Y.applyUpdate(ydoc, room.ydocState);
        } catch (err) {
          logger.error('Failed to apply ydocState snapshot: ' + err.message, { roomId: roomUuid });
        }

        // Self-healing: populate files array if missing
        const yfiles = ydoc.getArray(`${roomUuid}:files`);
        if (yfiles.length === 0 && room.files && room.files.length > 0) {
          const fileNames = Array.from(new Set(room.files.map((f) => f.name)));
          yfiles.push(fileNames);

          room.files.forEach((file) => {
            const ytext = ydoc.getText(`${roomUuid}:${file.name}`);
            if (ytext.toString() === '') {
              ydoc.transact(() => {
                ytext.insert(0, file.content || '');
              });
            }
          });
        }
      } else if (room.files) {
        const yfiles = ydoc.getArray(`${roomUuid}:files`);
        const fileNames = Array.from(new Set(room.files.map((f) => f.name)));
        yfiles.push(fileNames);

        room.files.forEach((file) => {
          const ytext = ydoc.getText(`${roomUuid}:${file.name}`);
          ydoc.transact(() => {
            ytext.insert(0, file.content || '');
          });
        });
      }
    }

    session = new RoomSession(roomUuid, ydoc, {
      pubsubAdapter: this.pubsubAdapter,
      nodeId: this.nodeId,
    });
    this.rooms.set(roomUuid, session);
    return session;
  }

  /**
   * Gets an active RoomSession by UUID, if currently in memory.
   *
   * @param {string} roomUuid - Target room UUID
   * @returns {RoomSession|null}
   */
  getRoom(roomUuid) {
    return this.rooms.get(roomUuid) || null;
  }

  /**
   * Unloads and destroys an inactive RoomSession from memory.
   *
   * @async
   * @param {string} roomUuid - Target room UUID
   * @returns {Promise<void>}
   */
  async unloadRoom(roomUuid) {
    const session = this.rooms.get(roomUuid);
    if (!session) return;

    logger.info('Room is inactive. Performing final save and unloading...', { roomId: roomUuid });
    await session.destroy();
    this.rooms.delete(roomUuid);
    logger.info('Unloaded room from server memory', { roomId: roomUuid });
  }

  /**
   * Gets connection count for a specific room.
   *
   * @param {string} roomUuid - Target room UUID
   * @param {WebSocket|null} [excludeWs=null] - Sockets to exclude
   * @returns {number}
   */
  getRoomConnectionCount(roomUuid, excludeWs = null) {
    const session = this.rooms.get(roomUuid);
    return session ? session.getConnectionCount(excludeWs) : 0;
  }

  /**
   * Gets live presence map of active users per room (FR-14).
   * Keyed by roomUuid; value is a Set of userIds.
   *
   * @returns {Map<string, Set<string>>}
   */
  getPresenceMap() {
    const presence = new Map();
    for (const [roomUuid, session] of this.rooms.entries()) {
      const userSet = new Set();
      for (const client of session.clients) {
        if (client.readyState === WebSocket.OPEN && client.userId) {
          userSet.add(client.userId);
        }
      }
      if (userSet.size > 0) {
        presence.set(roomUuid, userSet);
      }
    }
    return presence;
  }

  /**
   * Broadcasts a JSON string to all clients in a specific room.
   * Relays locally and publishes to cluster nodes via Pub/Sub adapter (NFR-53).
   *
   * @param {string} roomUuid - Target room UUID
   * @param {string} message - JSON string to broadcast
   */
  broadcastToRoom(roomUuid, message) {
    const session = this.rooms.get(roomUuid);
    if (session) {
      session.broadcastText(message);
    }
    if (this.pubsubAdapter && typeof this.pubsubAdapter.publish === 'function') {
      this.pubsubAdapter.publish(`collab:room:${roomUuid}`, {
        originNodeId: this.nodeId,
        type: 'broadcast_text',
        payload: message,
      });
    }
  }

  /**
   * Updates a user's role across their active WebSockets in a room (NFR-19).
   * Relays locally and publishes to cluster nodes via Pub/Sub adapter (NFR-53).
   *
   * @param {string} roomUuid - Target room UUID
   * @param {string} userId - User ID
   * @param {string} newRole - New role
   */
  updateClientRole(roomUuid, userId, newRole) {
    const session = this.rooms.get(roomUuid);
    if (session) {
      session.updateUserRole(userId, newRole);
    }
    if (this.pubsubAdapter && typeof this.pubsubAdapter.publish === 'function') {
      this.pubsubAdapter.publish(`collab:room:${roomUuid}`, {
        originNodeId: this.nodeId,
        type: 'role_update',
        userId,
        newRole,
      });
    }
  }

  /**
   * Broadcasts updated participant list to all clients in a room (FR-44).
   * Relays locally and publishes to cluster nodes via Pub/Sub adapter (NFR-53).
   *
   * @async
   * @param {string} roomUuid - Target room UUID
   * @returns {Promise<void>}
   */
  async broadcastRoomParticipants(roomUuid) {
    const session = this.rooms.get(roomUuid);
    let payload = null;

    try {
      const room = await Room.findOne({ uuid: roomUuid }).populate(
        'participants.user',
        'displayName email avatarColor'
      );
      if (room) {
        payload = JSON.stringify({
          type: 'participants_update',
          participants: room.participants.map((p) => ({
            userId: p.user._id,
            displayName: p.user.displayName,
            avatarColor: p.user.avatarColor,
            role: p.role,
          })),
        });
      }
    } catch (err) {
      logger.error('Error broadcasting participants: ' + err.message, { roomId: roomUuid });
    }

    if (payload) {
      if (session && session.clients.size > 0) {
        session.broadcastText(payload);
      }
      if (this.pubsubAdapter && typeof this.pubsubAdapter.publish === 'function') {
        this.pubsubAdapter.publish(`collab:room:${roomUuid}`, {
          originNodeId: this.nodeId,
          type: 'participants_update',
          payload,
        });
      }
    }
  }

  /**
   * Persists all active rooms during graceful shutdown (NFR-38).
   *
   * @async
   * @returns {Promise<void>}
   */
  async persistAllRooms() {
    const promises = [];
    for (const [roomUuid, session] of this.rooms.entries()) {
      if (session.saveTimer) {
        clearTimeout(session.saveTimer);
        session.saveTimer = null;
      }
      promises.push(
        saveRoomStateToDB(roomUuid, session.ydoc).catch((err) => {
          logger.error(`Error persisting room ${roomUuid} during shutdown: ` + err.message, {
            roomId: roomUuid,
          });
        })
      );
    }
    await Promise.allSettled(promises);
    this.rooms.clear();
  }

  /**
   * Total number of active WebSockets across all rooms.
   *
   * @returns {number}
   */
  getTotalActiveWebSockets() {
    let total = 0;
    for (const session of this.rooms.values()) {
      for (const client of session.clients) {
        if (client.readyState === WebSocket.OPEN) {
          total++;
        }
      }
    }
    return total;
  }

  /**
   * Returns diagnostic stats for all active rooms (NFR-52).
   *
   * @returns {Array<{ roomId: string, clientCount: number, messageCount: number, errorCount: number, rateLimitDrops: number }>}
   */
  getDiagnostics() {
    const stats = [];
    for (const [roomUuid, session] of this.rooms.entries()) {
      stats.push({
        roomId: roomUuid,
        clientCount: session.clients.size,
        messageCount: session.messageCount,
        bytesReceived: session.bytesReceived,
        errorCount: session.errorCount,
        rateLimitDrops: session.rateLimitDrops,
        lastActiveAt: session.lastActiveAt,
      });
    }
    return stats;
  }
}

const roomManager = new RoomManager();

roomManager.roomManager = roomManager;
roomManager.RoomSession = RoomSession;
roomManager.RoomManager = RoomManager;
roomManager.saveRoomStateToDB = saveRoomStateToDB;
roomManager.MAX_WS_FRAME_BYTES = MAX_WS_FRAME_BYTES;
roomManager.MAX_MSGS_PER_SEC_PER_CLIENT = MAX_MSGS_PER_SEC_PER_CLIENT;
roomManager.FLOOD_THRESHOLD_PER_SEC = FLOOD_THRESHOLD_PER_SEC;

module.exports = roomManager;
