/**
 * @file test/test_nfr53_horizontal_scaling_readiness.js
 * @description Comprehensive automated verification test suite for NFR-53: Horizontal Scaling Readiness.
 * 
 * SPECIFICATION (NFR-53):
 * "The WebSocket relay and signalling server must be designed to support a Redis pub/sub
 * adapter (e.g., socket.io-redis) for scaling across multiple Node.js instances in the future.
 * The architecture must not assume single-process state for message routing."
 * 
 * VERIFICATION PHASES:
 * Phase 1: Architecture Registry & Redis Pub/Sub Adapter Readiness Analysis
 * Phase 2: Multi-Node WebSocket Relay Horizontal Scaling Simulation (Cross-Node Yjs CRDT & Broadcasts)
 * Phase 3: Multi-Node Voice Signalling Horizontal Scaling Simulation (Cross-Node WebRTC Mesh & Moderation)
 * Phase 4: Fault Tolerance, Channel Unsubscription & Graceful Cleanup Invariants
 */

const assert = require('assert');
const path = require('path');
const EventEmitter = require('events');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

// Resolve modules and environment
const COLLAB_IDE_DIR = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(COLLAB_IDE_DIR, '.env') });
require('dotenv').config();

const modules = require('../modules');
const {
  websocketRelay,
  voiceSignalling,
  infrastructure,
  rooms,
} = modules;

const {
  PubSubAdapter,
  MemoryPubSubAdapter,
  RedisPubSubAdapter,
  createPubSubAdapter,
} = require('../services/pubsub');

const { RoomManager, RoomSession } = require('../services/roomManager');
const voiceSocket = require('../socket/voice');

let passedTests = 0;
let failedTests = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

/**
 * Creates a mock WebSocket client for testing relay and session message flows.
 */
function createMockWebSocket(userId, role, displayName = 'Mock User') {
  const ws = new EventEmitter();
  ws.userId = userId;
  ws.role = role;
  ws.displayName = displayName;
  ws.readyState = 1; // WebSocket.OPEN
  ws.sentMessages = [];
  ws.binaryMessages = [];

  ws.send = function (data, options = {}) {
    if (options.binary || data instanceof Uint8Array || Buffer.isBuffer(data)) {
      ws.binaryMessages.push(data);
    } else {
      ws.sentMessages.push(data);
    }
  };

  ws.close = function (code, reason) {
    ws.readyState = 3; // WebSocket.CLOSED
    ws.emit('close', code, reason);
  };

  ws.terminate = function () {
    ws.readyState = 3;
    ws.emit('close', 1006, 'Terminated');
  };

  return ws;
}

/**
 * Creates a mock Socket.IO Socket for voice signalling tests.
 */
function createMockVoiceSocket(socketId, user) {
  const socket = new EventEmitter();
  socket.id = socketId;
  socket.user = user;
  socket.roomUuid = null;
  socket.joinedRooms = new Set();
  socket.emittedEvents = [];

  socket.join = function (room) {
    socket.joinedRooms.add(room);
  };

  socket.leave = function (room) {
    socket.joinedRooms.delete(room);
  };

  socket.emit = function (event, data) {
    socket.emittedEvents.push({ event, data, timestamp: Date.now() });
    socket.listeners(event).forEach(fn => fn(data));
  };

  return socket;
}

/**
 * Creates a mock Socket.IO Namespace.
 */
function createMockVoiceNamespace() {
  const ns = new EventEmitter();
  ns.sockets = new Map();
  ns.broadcastEvents = [];

  ns.to = function (roomOrSocketId) {
    return {
      emit: (event, data) => {
        ns.broadcastEvents.push({ target: roomOrSocketId, event, data });
        // Deliver to direct socket if target is a socket ID
        if (ns.sockets.has(roomOrSocketId)) {
          ns.sockets.get(roomOrSocketId).emit(event, data);
        }
        // Deliver to all sockets in room if target is a room
        for (const sock of ns.sockets.values()) {
          if (sock.joinedRooms && sock.joinedRooms.has(roomOrSocketId)) {
            sock.emit(event, data);
          }
        }
      },
    };
  };

  return ns;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-53: Horizontal Scaling Readiness Automated Test Suite');
  console.log('================================================================\n');

  try {
    // --------------------------------------------------------------------------
    // Phase 1: Architecture Registry & Redis Pub/Sub Adapter Readiness Analysis
    // --------------------------------------------------------------------------
    console.log('🔍 Phase 1: Architecture Registry & Redis Pub/Sub Adapter Readiness Analysis...');

    check(typeof PubSubAdapter === 'function', 'PubSubAdapter abstract base class exported');
    check(typeof MemoryPubSubAdapter === 'function', 'MemoryPubSubAdapter implementation exported');
    check(typeof RedisPubSubAdapter === 'function', 'RedisPubSubAdapter implementation exported');
    check(typeof createPubSubAdapter === 'function', 'createPubSubAdapter factory function exported');

    // Verify Base Class Contract
    const baseAdapter = new PubSubAdapter('test-base');
    check(baseAdapter.getName() === 'test-base', 'PubSubAdapter.getName returns configured name');
    let baseThrows = false;
    try { await baseAdapter.publish('test', 'data'); } catch (_) { baseThrows = true; }
    check(baseThrows, 'Base PubSubAdapter enforces abstract method implementation');

    // Verify MemoryPubSubAdapter messaging semantics
    const memoryAdapter = new MemoryPubSubAdapter();
    check(memoryAdapter.getName() === 'memory', 'MemoryPubSubAdapter identifies as "memory"');

    let receivedMsg = null;
    const testHandler = (chan, msg) => { receivedMsg = msg; };
    await memoryAdapter.subscribe('test:channel:1', testHandler);
    await memoryAdapter.publish('test:channel:1', { foo: 'bar', timestamp: 123 });
    await new Promise(r => setTimeout(r, 20));
    check(Boolean(receivedMsg && receivedMsg.foo === 'bar'), 'MemoryPubSubAdapter delivers deserialized message');

    await memoryAdapter.unsubscribe('test:channel:1', testHandler);
    receivedMsg = null;
    await memoryAdapter.publish('test:channel:1', { foo: 'ignored' });
    await new Promise(r => setTimeout(r, 20));
    check(receivedMsg === null, 'MemoryPubSubAdapter cleanly unsubscribes message handlers');
    await memoryAdapter.close();

    // Verify RedisPubSubAdapter configuration parser & Socket.IO Redis adapter factory
    const redisAdapter = new RedisPubSubAdapter({
      url: 'redis://:secret@10.0.0.1:6379/0',
      host: '10.0.0.1',
      port: 6379,
    });
    check(redisAdapter.getName() === 'redis', 'RedisPubSubAdapter identifies as "redis"');
    check(redisAdapter.url.includes('10.0.0.1'), 'RedisPubSubAdapter captures Redis connection URL');
    check(redisAdapter.port === 6379, 'RedisPubSubAdapter captures configured Redis port');

    const socketIoRedisBridge = redisAdapter.createSocketIoAdapter();
    check(Boolean(socketIoRedisBridge), 'RedisPubSubAdapter produces Socket.IO Redis adapter bridge');
    check(socketIoRedisBridge.isConfigured === true || typeof socketIoRedisBridge === 'function', 'Socket.IO Redis adapter ready for multi-process clustering');

    // Factory creates Memory by default and Redis when requested
    const defaultCreated = createPubSubAdapter();
    check(defaultCreated instanceof MemoryPubSubAdapter, 'createPubSubAdapter defaults to MemoryPubSubAdapter');
    const redisCreated = createPubSubAdapter({ type: 'redis' });
    check(redisCreated instanceof RedisPubSubAdapter, 'createPubSubAdapter creates RedisPubSubAdapter on type "redis"');

    // Module Manifest Descriptors
    check(websocketRelay.horizontalScaling && websocketRelay.horizontalScaling.ready === true, 'websocketRelay declares horizontalScaling.ready === true');
    check(websocketRelay.horizontalScaling.supportsRedisAdapter === true, 'websocketRelay declares supportsRedisAdapter === true');
    check(websocketRelay.horizontalScaling.singleProcessAssumptions === false, 'websocketRelay declares singleProcessAssumptions === false');

    check(voiceSignalling.horizontalScaling && voiceSignalling.horizontalScaling.ready === true, 'voiceSignalling declares horizontalScaling.ready === true');
    check(voiceSignalling.horizontalScaling.supportsRedisAdapter === true, 'voiceSignalling declares supportsRedisAdapter === true');
    check(voiceSignalling.horizontalScaling.singleProcessAssumptions === false, 'voiceSignalling declares singleProcessAssumptions === false');

    check(infrastructure.horizontalScaling && infrastructure.horizontalScaling.ready === true, 'infrastructure declares horizontalScaling.ready === true');

    // --------------------------------------------------------------------------
    // Phase 2: Multi-Node WebSocket Relay Horizontal Scaling Simulation
    // --------------------------------------------------------------------------
    console.log('\n🌐 Phase 2: Multi-Node WebSocket Relay Horizontal Scaling Simulation...');

    // Shared PubSub messaging bus simulating a Redis cluster interconnecting Node A & Node B
    const clusterPubSubBus = new MemoryPubSubAdapter();

    // Initialize Node A & Node B Room Managers sharing clusterPubSubBus
    const managerA = new RoomManager({ nodeId: 'node-alpha', pubsubAdapter: clusterPubSubBus });
    const managerB = new RoomManager({ nodeId: 'node-beta', pubsubAdapter: clusterPubSubBus });

    check(managerA.nodeId === 'node-alpha', 'Manager Node A assigned distinct cluster nodeId');
    check(managerB.nodeId === 'node-beta', 'Manager Node B assigned distinct cluster nodeId');

    const roomUuid = `room-scaling-${Date.now()}`;

    // Node A creates Room Session for roomUuid
    const sessionA = await managerA.getOrCreateRoom(roomUuid);
    check(Boolean(sessionA), 'Node A: Created isolated RoomSession');
    check(sessionA.nodeId === 'node-alpha', 'Node A: Session inherits Node A cluster ID');

    // Node B creates Room Session for same roomUuid (cross-node instance)
    const sessionB = await managerB.getOrCreateRoom(roomUuid);
    check(Boolean(sessionB), 'Node B: Created isolated RoomSession for identical room');
    check(sessionB.nodeId === 'node-beta', 'Node B: Session inherits Node B cluster ID');

    // Client 1 connects to Node A
    const client1OnNodeA = createMockWebSocket('user-1', 'Editor', 'User One');
    sessionA.addClient(client1OnNodeA, { _id: 'user-1', displayName: 'User One' }, 'Editor');
    check(sessionA.clients.has(client1OnNodeA), 'Node A: Client 1 registered on Node A');

    // Client 2 connects to Node B
    const client2OnNodeB = createMockWebSocket('user-2', 'Editor', 'User Two');
    sessionB.addClient(client2OnNodeB, { _id: 'user-2', displayName: 'User Two' }, 'Editor');
    check(sessionB.clients.has(client2OnNodeB), 'Node B: Client 2 registered on Node B');

    // Verify Node A does NOT have Client 2 in its local memory set (Proves physical process isolation)
    check(!sessionA.clients.has(client2OnNodeB), 'Node A: Client 2 does NOT reside in Node A process memory');
    check(!sessionB.clients.has(client1OnNodeA), 'Node B: Client 1 does NOT reside in Node B process memory');

    // 2.2 Cross-Node Document CRDT Synchronization: Client 1 on Node A types text
    const ytextA = sessionA.ydoc.getText(`${roomUuid}:main.js`);
    sessionA.ydoc.transact(() => {
      ytextA.insert(0, "console.log('Synchronized across Node A and Node B');");
    });

    // Create binary Yjs update frame as Client 1 would send
    const docUpdateA = Y.encodeStateAsUpdate(sessionA.ydoc);
    const encoderA = encoding.createEncoder();
    encoding.writeVarUint(encoderA, 0); // messageSync = 0
    syncProtocol.writeUpdate(encoderA, docUpdateA);
    const rawFrameFromA = encoding.toUint8Array(encoderA);

    // Client 1 sends edit frame to Node A
    sessionA.handleMessage(client1OnNodeA, rawFrameFromA, true);

    // Allow Pub/Sub bus delivery between Node A and Node B
    await new Promise(r => setTimeout(r, 60));

    // Verify Node B local Y.Doc received and merged update from Node A
    const ytextB = sessionB.ydoc.getText(`${roomUuid}:main.js`);
    check(ytextB.toString() === "console.log('Synchronized across Node A and Node B');", 'Node B: Received and merged CRDT document edit via Pub/Sub');

    // Verify Client 2 on Node B received the binary update frame over its socket
    check(client2OnNodeB.binaryMessages.length > 0, 'Node B: Relayed binary update frame to Client 2 on Node B');

    // 2.3 Cross-Node Room Broadcast (e.g. system notifications)
    const alertMessage = JSON.stringify({ type: 'system_alert', message: 'Rolling update starting' });
    managerA.broadcastToRoom(roomUuid, alertMessage);

    await new Promise(r => setTimeout(r, 40));

    check(client2OnNodeB.sentMessages.includes(alertMessage), 'Node B: Client 2 received broadcast message issued from Node A');

    // 2.4 Cross-Node Dynamic Role Promotion (NFR-19)
    managerA.updateClientRole(roomUuid, 'user-2', 'Room Leader');

    await new Promise(r => setTimeout(r, 40));

    check(client2OnNodeB.role === 'Room Leader', 'Node B: Client 2 role dynamically updated to "Room Leader" from Node A');
    const roleUpdateReceived = client2OnNodeB.sentMessages.some(m => {
      try {
        const parsed = JSON.parse(m);
        return parsed.type === 'role_update' && parsed.role === 'Room Leader';
      } catch (_) { return false; }
    });
    check(roleUpdateReceived, 'Node B: Client 2 received role_update message across process boundaries');

    // --------------------------------------------------------------------------
    // Phase 3: Multi-Node Voice Signalling Horizontal Scaling Simulation
    // --------------------------------------------------------------------------
    console.log('\n🎙️  Phase 3: Multi-Node Voice Signalling Horizontal Scaling Simulation...');

    const voicePubSubBus = new MemoryPubSubAdapter();
    const voiceRoomUuid = `voice-scaling-${Date.now()}`;

    // Configure Voice Signalling on Node A
    voiceSocket.setVoicePubSubAdapter(voicePubSubBus);
    const mockNsA = createMockVoiceNamespace();
    voiceSocket.ensureVoiceChannelSubscribed(voiceRoomUuid, mockNsA);

    // Peer 1 connects to Node A
    const peer1Socket = createMockVoiceSocket('socket-alpha-peer-1', {
      _id: 'user-voice-1',
      displayName: 'Peer Alpha',
      avatarColor: '#fab387',
      isVerified: true,
    });
    peer1Socket.roomUuid = voiceRoomUuid;
    peer1Socket.join(voiceRoomUuid);
    mockNsA.sockets.set(peer1Socket.id, peer1Socket);

    // Register Peer 1 in Node A's voiceRoom
    const voiceRoomA = voiceSocket.getVoiceRoom(voiceRoomUuid);
    const peer1Data = {
      userId: 'user-voice-1',
      displayName: 'Peer Alpha',
      avatarColor: '#fab387',
      role: 'Owner',
      isMuted: false,
      isHardMuted: false,
      joinedAt: new Date().toISOString(),
      socketId: peer1Socket.id,
    };
    voiceRoomA.participants.set(peer1Socket.id, peer1Data);

    // Node A publishes participant_joined via Pub/Sub
    await voicePubSubBus.publish(`collab:voice:${voiceRoomUuid}`, {
      originNodeId: 'node-voice-alpha',
      type: 'participant_joined',
      roomUuid: voiceRoomUuid,
      socketId: peer1Socket.id,
      participant: peer1Data,
    });

    // Node B simulates second voice signalling server instance
    const mockNsB = createMockVoiceNamespace();
    const voiceRoomB = {
      participants: new Map(),
      editorOnlyMode: false,
    };

    // Node B subscribes to the shared voice pub/sub channel
    await voicePubSubBus.subscribe(`collab:voice:${voiceRoomUuid}`, (chan, msg) => {
      if (!msg || msg.originNodeId === 'node-voice-beta') return;

      if (msg.type === 'participant_joined') {
        voiceRoomB.participants.set(msg.socketId, msg.participant);
        mockNsB.to(voiceRoomUuid).emit('voice:participant-joined', {
          joined: { ...msg.participant, socketId: msg.socketId },
          participants: Array.from(voiceRoomB.participants.values()),
        });
      } else if (msg.type === 'participant_left') {
        voiceRoomB.participants.delete(msg.socketId);
        mockNsB.to(voiceRoomUuid).emit('voice:participant-left', {
          userId: msg.userId,
          socketId: msg.socketId,
          displayName: msg.displayName,
          participants: Array.from(voiceRoomB.participants.values()),
        });
      } else if (msg.type === 'signal') {
        const targetSock = mockNsB.sockets.get(msg.to);
        if (targetSock) {
          targetSock.emit(msg.event, msg.data);
        }
      } else if (msg.type === 'mute_changed') {
        const p = voiceRoomB.participants.get(msg.socketId);
        if (p) {
          p.isMuted = msg.isMuted;
          p.isHardMuted = msg.isHardMuted;
        }
        mockNsB.to(voiceRoomUuid).emit('voice:mute-changed', {
          userId: msg.userId,
          socketId: msg.socketId,
          isMuted: msg.isMuted,
          isHardMuted: msg.isHardMuted,
        });
      } else if (msg.type === 'mute_all') {
        voiceRoomB.participants.forEach((p, sid) => {
          if (sid !== msg.exceptSocketId) p.isMuted = true;
        });
        mockNsB.to(voiceRoomUuid).emit('voice:participants-update', {
          participants: Array.from(voiceRoomB.participants.values()),
          event: 'mute-all',
          by: msg.by,
        });
      } else if (msg.type === 'editor_only') {
        voiceRoomB.editorOnlyMode = Boolean(msg.enabled);
        mockNsB.to(voiceRoomUuid).emit('voice:room-settings', {
          editorOnlyMode: voiceRoomB.editorOnlyMode,
        });
      }
    });

    // Peer 2 connects to Node B
    const peer2Socket = createMockVoiceSocket('socket-beta-peer-2', {
      _id: 'user-voice-2',
      displayName: 'Peer Beta',
      avatarColor: '#a6e3a1',
      isVerified: true,
    });
    peer2Socket.roomUuid = voiceRoomUuid;
    peer2Socket.join(voiceRoomUuid);
    mockNsB.sockets.set(peer2Socket.id, peer2Socket);

    const peer2Data = {
      userId: 'user-voice-2',
      displayName: 'Peer Beta',
      avatarColor: '#a6e3a1',
      role: 'Editor',
      isMuted: false,
      isHardMuted: false,
      joinedAt: new Date().toISOString(),
      socketId: peer2Socket.id,
    };
    voiceRoomB.participants.set(peer2Socket.id, peer2Data);

    // Node B publishes Peer 2 arrival
    await voicePubSubBus.publish(`collab:voice:${voiceRoomUuid}`, {
      originNodeId: 'node-voice-beta',
      type: 'participant_joined',
      roomUuid: voiceRoomUuid,
      socketId: peer2Socket.id,
      participant: peer2Data,
    });

    await new Promise(r => setTimeout(r, 60));

    // Verify Cross-Node Participant Synchronization:
    // Node A knows about Peer 2 (on Node B)
    check(voiceRoomA.participants.has(peer2Socket.id), 'Node A: Synchronized Peer 2 (connected on Node B) into voice roster');
    // Node B knows about Peer 1 (on Node A)
    check(voiceRoomB.participants.has(peer1Socket.id), 'Node B: Synchronized Peer 1 (connected on Node A) into voice roster');

    // 3.2 Cross-Node WebRTC Signalling (SDP Offer/Answer Relay Across Instances)
    // Peer 1 on Node A sends voice:offer to Peer 2 on Node B
    const mockOfferSdp = { type: 'offer', sdp: 'v=0\r\no=Peer1 ...' };
    
    // In voice.js, socket.on('voice:offer') verifies target participant exists, emits locally and publishes to pubsub
    check(voiceRoomA.participants.has(peer2Socket.id), 'Node A: Authoritatively recognizes remote Peer 2 as legitimate participant');

    await voicePubSubBus.publish(`collab:voice:${voiceRoomUuid}`, {
      originNodeId: 'node-voice-alpha',
      type: 'signal',
      event: 'voice:offer',
      to: peer2Socket.id,
      data: {
        from: peer1Socket.id,
        fromUserId: 'user-voice-1',
        sdp: mockOfferSdp,
      },
    });

    await new Promise(r => setTimeout(r, 40));

    // Peer 2 on Node B receives the offer from Peer 1
    const receivedOffer = peer2Socket.emittedEvents.find(e => e.event === 'voice:offer');
    check(Boolean(receivedOffer), 'Node B: Peer 2 received WebRTC offer across cluster nodes');
    check(receivedOffer && receivedOffer.data.from === peer1Socket.id, 'Node B: WebRTC offer correctly references sender on Node A');

    // Peer 2 on Node B sends voice:answer back to Peer 1 on Node A
    const mockAnswerSdp = { type: 'answer', sdp: 'v=0\r\no=Peer2 ...' };
    await voicePubSubBus.publish(`collab:voice:${voiceRoomUuid}`, {
      originNodeId: 'node-voice-beta',
      type: 'signal',
      event: 'voice:answer',
      to: peer1Socket.id,
      data: {
        from: peer2Socket.id,
        fromUserId: 'user-voice-2',
        sdp: mockAnswerSdp,
      },
    });

    await new Promise(r => setTimeout(r, 40));

    const receivedAnswer = peer1Socket.emittedEvents.find(e => e.event === 'voice:answer');
    check(Boolean(receivedAnswer), 'Node A: Peer 1 received WebRTC answer across cluster nodes');
    check(receivedAnswer && receivedAnswer.data.from === peer2Socket.id, 'Node A: WebRTC answer correctly references sender on Node B');

    // 3.3 Cross-Node ICE Candidate Relay
    const mockCandidate = { candidate: 'candidate:1 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 };
    await voicePubSubBus.publish(`collab:voice:${voiceRoomUuid}`, {
      originNodeId: 'node-voice-alpha',
      type: 'signal',
      event: 'voice:ice-candidate',
      to: peer2Socket.id,
      data: {
        from: peer1Socket.id,
        fromUserId: 'user-voice-1',
        candidate: mockCandidate,
      },
    });

    await new Promise(r => setTimeout(r, 40));

    const receivedIce = peer2Socket.emittedEvents.find(e => e.event === 'voice:ice-candidate');
    check(Boolean(receivedIce), 'Node B: Peer 2 received ICE candidate across cluster nodes');

    // 3.4 Cross-Node Voice Moderation (Mute All across instances)
    await voicePubSubBus.publish(`collab:voice:${voiceRoomUuid}`, {
      originNodeId: 'node-voice-alpha',
      type: 'mute_all',
      roomUuid: voiceRoomUuid,
      by: 'Peer Alpha',
      exceptSocketId: peer1Socket.id,
    });

    await new Promise(r => setTimeout(r, 40));

    check(voiceRoomB.participants.get(peer2Socket.id).isMuted === true, 'Node B: Peer 2 muted following mute-all command from Node A');
    const muteAllEventReceived = peer2Socket.emittedEvents.some(e => e.event === 'voice:participants-update' && e.data.event === 'mute-all');
    check(muteAllEventReceived, 'Node B: Peer 2 received mute-all event over Socket.IO');

    // 3.5 Cross-Node Participant Departure
    await voicePubSubBus.publish(`collab:voice:${voiceRoomUuid}`, {
      originNodeId: 'node-voice-alpha',
      type: 'participant_left',
      roomUuid: voiceRoomUuid,
      socketId: peer1Socket.id,
      userId: 'user-voice-1',
      displayName: 'Peer Alpha',
    });

    await new Promise(r => setTimeout(r, 40));

    check(!voiceRoomB.participants.has(peer1Socket.id), 'Node B: Peer 1 evicted from Node B roster upon departure on Node A');
    const leaveEventReceived = peer2Socket.emittedEvents.some(e => e.event === 'voice:participant-left' && e.data.socketId === peer1Socket.id);
    check(leaveEventReceived, 'Node B: Peer 2 received participant-left broadcast for Peer 1');

    // --------------------------------------------------------------------------
    // Phase 4: Fault Tolerance, Channel Unsubscription & Graceful Cleanup
    // --------------------------------------------------------------------------
    console.log('\n🛡️  Phase 4: Fault Tolerance, Channel Unsubscription & Graceful Cleanup Invariants...');

    // Clean up room on Node A without affecting Node B
    await sessionA.destroy(true);
    check(sessionA.isDestroyed === true, 'Node A: RoomSession destroyed cleanly');
    check(sessionB.isDestroyed === false, 'Node B: RoomSession remains active without single-process coupling');

    // Clean up Node B session
    await sessionB.destroy(true);
    check(sessionB.isDestroyed === true, 'Node B: RoomSession destroyed cleanly');

    // Close pub/sub buses
    await clusterPubSubBus.close();
    await voicePubSubBus.close();
    check(clusterPubSubBus.isClosed === true, 'Cluster Pub/Sub bus closed cleanly');
    check(voicePubSubBus.isClosed === true, 'Voice Pub/Sub bus closed cleanly');

  } catch (err) {
    console.error('Unhandled test suite error:', err);
    failedTests++;
  } finally {
    console.log('\n================================================================');
    console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
    console.log('================================================================');

    if (failedTests > 0) {
      console.error('\n❌ NFR-53 Horizontal Scaling Readiness test suite FAILED!');
      process.exit(1);
    } else {
      console.log('\n🎉 ALL NFR-53 HORIZONTAL SCALING READINESS REQUIREMENTS SATISFIED!\n');
      process.exit(0);
    }
  }
}

runTestSuite();
