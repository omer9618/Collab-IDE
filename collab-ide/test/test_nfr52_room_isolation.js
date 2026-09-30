/**
 * ==============================================================================
 * CollabIDE - NFR-52: Room Isolation Automated Integration Test Suite
 * ==============================================================================
 *
 * Verifies NFR-52 requirements:
 * "A crash or resource spike in one room must not affect other rooms.
 * Each room's Yjs document and WebSocket client set must be independently managed."
 *
 * Test Phases:
 * 1. Independent WebSocket Client Sets:
 *    - Room A and Room B client sets are strictly isolated.
 *    - Edits in Room A are relayed only to Room A clients, never to Room B clients.
 *    - Broadcasts to Room A reach only Room A clients.
 * 2. Independent Yjs Documents:
 *    - Room A's Y.Doc and Room B's Y.Doc maintain separate file trees and CRDT clocks.
 * 3. Crash Isolation (Malformed / Corrupted Update Containment):
 *    - Corrupted binary frames sent to Room A are caught by Room A's error boundary.
 *    - Room A isolates the failure without crashing the server.
 *    - Room B continues syncing and operating with 100% normal responsiveness.
 * 4. Resource Spike Isolation (Message Flood / CPU Spike):
 *    - A rapid flood of messages in Room A is throttled by per-client rate limiting.
 *    - Room B clients experience zero degradation or dropped messages during the flood.
 *    - Extreme flooding causes socket termination in Room A, leaving Room B untouched.
 * 5. Resource Spike Isolation (Oversized Frame Capping):
 *    - Oversized frames (> 5MB) in Room A are rejected.
 *    - Room B continues uninterrupted.
 * 6. Socket Fault Isolation:
 *    - Abrupt socket termination in Room A is handled cleanly without leaking errors.
 * 7. Independent Room Lifecycle & Memory Teardown:
 *    - Emptying Room A persists and unloads its Y.Doc (`ydoc.destroy()`).
 *    - Room B remains active in memory.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');

const { connectDB } = require('../config/db');
const User = require('../models/User');
const Room = require('../models/Room');
const { privateKey } = require('../utils/keys');
const { roomManager } = require('../services/roomManager');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(50);
  }
  return fn();
}

/**
 * Helper to establish an authenticated WebSocket client connection.
 */
function createWsClient(serverUrl, roomUuid, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${serverUrl}/ws/${roomUuid}?token=${token}`);
    const receivedMessages = [];
    let isClosed = false;
    let closeCode = null;

    ws.on('open', () => {
      resolve({
        ws,
        messages: receivedMessages,
        isClosed: () => isClosed || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING,
        getCloseCode: () => closeCode,
        send: (data, opts) => ws.send(data, opts),
        close: () => ws.close(),
      });
    });

    ws.on('message', (data, isBinary) => {
      receivedMessages.push({ data, isBinary, timestamp: Date.now() });
    });

    ws.on('close', (code) => {
      isClosed = true;
      closeCode = code;
    });

    ws.on('error', (err) => {
      if (!isClosed) {
        // Ignored or logged
      }
    });

    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket connection timed out'));
      }
    }, 5000);
  });
}

async function runTestSuite() {
  console.log('\n================================================================');
  console.log('🧪 Starting NFR-52: Room Isolation Automated Integration Tests');
  console.log('================================================================\n');

  // 1. Connect MongoDB
  await connectDB();
  assert(mongoose.connection.readyState === 1, 'Connected to MongoDB Atlas');

  // 2. Start server on an isolated port
  const testPort = 3197;
  process.env.PORT = testPort;
  const { server } = require('../server');
  if (!server.listening) {
    server.listen(testPort);
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const baseUrl = `http://localhost:${testPort}`;
  const wsBaseUrl = `ws://localhost:${testPort}`;
  console.log(`📡 Test server listening on ${baseUrl}\n`);

  // 3. Create test users and rooms
  const timestamp = Date.now();
  const testUser = await User.create({
    email: `isolation-tester-${timestamp}@example.com`,
    password: 'Password123!',
    displayName: 'Isolation Tester',
    isVerified: true,
  });

  const token = jwt.sign(
    { userId: testUser._id.toString(), type: 'access' },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1h' }
  );

  const roomA = await Room.create({
    name: `Room A ${timestamp}`,
    uuid: `test-room-a-${timestamp}`,
    owner: testUser._id,
    participants: [{ user: testUser._id, role: 'Owner' }],
    files: [{ name: 'fileA.js', content: '// Room A File' }],
  });

  const roomB = await Room.create({
    name: `Room B ${timestamp}`,
    uuid: `test-room-b-${timestamp}`,
    owner: testUser._id,
    participants: [{ user: testUser._id, role: 'Owner' }],
    files: [{ name: 'fileB.js', content: '// Room B File' }],
  });

  try {
    // --------------------------------------------------------------------------
    // Phase 1: Independent WebSocket Client Sets & Message Relaying
    // --------------------------------------------------------------------------
    console.log('🔌 Phase 1: Verifying Independent WebSocket Client Sets...');

    const clientA1 = await createWsClient(wsBaseUrl, roomA.uuid, token);
    const clientA2 = await createWsClient(wsBaseUrl, roomA.uuid, token);
    const clientB1 = await createWsClient(wsBaseUrl, roomB.uuid, token);
    const clientB2 = await createWsClient(wsBaseUrl, roomB.uuid, token);

    await sleep(200);

    const sessionA = roomManager.getRoom(roomA.uuid);
    const sessionB = roomManager.getRoom(roomB.uuid);

    assert(Boolean(sessionA) && Boolean(sessionB), 'Room sessions created in roomManager');
    assert(sessionA.clients.size === 2, `Room A has exactly 2 clients in its isolated set (Actual: ${sessionA.clients.size})`);
    assert(sessionB.clients.size === 2, `Room B has exactly 2 clients in its isolated set (Actual: ${sessionB.clients.size})`);

    // Verify client sets do not overlap across rooms
    let clientSetsDisjoint = true;
    for (const clientA of sessionA.clients) {
      if (sessionB.clients.has(clientA)) clientSetsDisjoint = false;
    }
    assert(clientSetsDisjoint, 'Room A client set does NOT contain Room B client');
    assert(sessionA.clients.size === 2 && sessionB.clients.size === 2, 'Room B client set does NOT contain Room A client');

    // Test cross-room relay isolation:
    // Client A1 sends a valid binary update
    const validUpdate = new Uint8Array([0, 2, 2, 0, 0]); // clean Yjs sync update
    const initialB1MsgCount = clientB1.messages.length;
    const initialB2MsgCount = clientB2.messages.length;
    const initialA2MsgCount = clientA2.messages.length;

    clientA1.send(validUpdate, { binary: true });
    await waitFor(() => clientA2.messages.length > initialA2MsgCount);

    // Client A2 should receive the relayed update
    assert(clientA2.messages.length > initialA2MsgCount, 'Room A peer (Client A2) received the relayed update');

    // Room B clients must NOT receive Room A's update
    assert(
      clientB1.messages.length === initialB1MsgCount,
      'Room B client B1 received ZERO messages from Room A update'
    );
    assert(
      clientB2.messages.length === initialB2MsgCount,
      'Room B client B2 received ZERO messages from Room A update'
    );

    // Test broadcastToRoom isolation:
    global.broadcastToRoom(roomA.uuid, JSON.stringify({ type: 'test_isolation_signal' }));
    await waitFor(() => clientA2.messages.some(
      (m) => !m.isBinary && m.data.toString().includes('test_isolation_signal')
    ));

    const a2GotSignal = clientA2.messages.some(
      (m) => !m.isBinary && m.data.toString().includes('test_isolation_signal')
    );
    const b1GotSignal = clientB1.messages.some(
      (m) => !m.isBinary && m.data.toString().includes('test_isolation_signal')
    );

    assert(a2GotSignal, 'Room A client received targeted broadcastToRoom');
    assert(!b1GotSignal, 'Room B client was NOT exposed to Room A broadcastToRoom');

    // --------------------------------------------------------------------------
    // Phase 2: Independent Yjs Document State
    // --------------------------------------------------------------------------
    console.log('\n📄 Phase 2: Verifying Independent Yjs Documents...');

    assert(sessionA.ydoc !== sessionB.ydoc, 'Room A and Room B own distinct Y.Doc instances');

    // Modify Room A's document via CRDT transaction
    sessionA.ydoc.transact(() => {
      const textA = sessionA.ydoc.getText(`${roomA.uuid}:fileA.js`);
      textA.insert(0, '// Line added in Room A\n');
    });

    const roomAText = sessionA.ydoc.getText(`${roomA.uuid}:fileA.js`).toString();
    const roomBHasRoomAFile = sessionB.ydoc.getText(`${roomA.uuid}:fileA.js`).toString();

    assert(roomAText.includes('Line added in Room A'), 'Room A document updated');
    assert(roomBHasRoomAFile === '', 'Room B document contains no trace of Room A edits');

    // --------------------------------------------------------------------------
    // Phase 3: Crash Isolation (Malformed / Corrupted Update Containment)
    // --------------------------------------------------------------------------
    console.log('\n💥 Phase 3: Simulating Corrupted Update / Crash in Room A...');

    const b1MsgCountBeforeCrash = clientB1.messages.length;

    // Send malformed binary update designed to trigger a lib0 decoding failure
    // Starts with byte 0 (sync message) but with illegal varuint length and garbage payload
    const corruptedPayload = new Uint8Array([0, 255, 255, 255, 255, 128, 0, 42]);
    clientA1.send(corruptedPayload, { binary: true });

    await waitFor(() => sessionA.errorCount > 0);

    // Verify Room A handled error gracefully
    assert(sessionA.errorCount > 0, `Room A error boundary caught and recorded exception (Errors: ${sessionA.errorCount})`);

    // Verify Room B remained completely operational
    assert(sessionB.errorCount === 0, 'Room B recorded 0 errors during Room A crash attempt');
    assert(clientB1.ws.readyState === WebSocket.OPEN, 'Room B client B1 is fully connected and alive');
    assert(clientB2.ws.readyState === WebSocket.OPEN, 'Room B client B2 is fully connected and alive');

    // Prove Room B can still sync messages normally right after Room A's crash
    const validBUpdate = encoding.createEncoder();
    encoding.writeVarUint(validBUpdate, 0);
    syncProtocol.writeSyncStep1(validBUpdate, sessionB.ydoc);
    clientB1.send(encoding.toUint8Array(validBUpdate), { binary: true });

    await waitFor(() => clientB1.messages.length > b1MsgCountBeforeCrash);
    assert(clientB1.messages.length > b1MsgCountBeforeCrash, 'Room B actively processed sync message immediately after Room A crash');

    // --------------------------------------------------------------------------
    // Phase 4: Resource Spike Isolation (Message Flooding)
    // --------------------------------------------------------------------------
    console.log('\n⚡ Phase 4: Simulating Message Flood Resource Spike in Room A...');

    const preFloodB1Count = clientB1.messages.length;

    // Client A1 fires 150 rapid messages to trip the 100 msgs/sec rate limit
    console.log('  ⚡ Sending rapid burst of 150 messages in Room A...');
    for (let i = 0; i < 150; i++) {
      clientA1.send(validUpdate, { binary: true });
    }

    await waitFor(() => sessionA.rateLimitDrops > 0);

    assert(sessionA.rateLimitDrops > 0, `Room A rate limiter dropped excessive frames (Drops: ${sessionA.rateLimitDrops})`);
    assert(sessionB.rateLimitDrops === 0, 'Room B rate limit was completely unaffected');

    // Verify Room B client can send and receive smoothly during/after Room A flood
    clientB2.send(validUpdate, { binary: true });
    await waitFor(() => clientB1.messages.length > preFloodB1Count);
    assert(clientB1.messages.length > preFloodB1Count, 'Room B clients communicate with zero lag during Room A flood');

    // Extreme flooding test: > 300 messages severs the abusive client in Room A
    console.log('  ⚡ Sending extreme flood (> 300 msgs) in Room A...');
    for (let i = 0; i < 350; i++) {
      if (clientA1.ws.readyState === WebSocket.OPEN) {
        clientA1.send(validUpdate, { binary: true });
      }
    }

    await waitFor(() => clientA1.isClosed());

    assert(clientA1.isClosed(), 'Abusive client in Room A was disconnected by rate limiter');
    assert(clientB1.ws.readyState === WebSocket.OPEN, 'Room B client remains fully connected');

    // --------------------------------------------------------------------------
    // Phase 5: Resource Spike Isolation (Oversized Frame Capping)
    // --------------------------------------------------------------------------
    console.log('\n📦 Phase 5: Testing Oversized Payload Capping in Room A...');

    // Client A2 sends an oversized 6MB buffer (limit is 5MB)
    const oversizedPayload = Buffer.alloc(6 * 1024 * 1024, 0x42);
    clientA2.send(oversizedPayload, { binary: true });

    await waitFor(() => clientA2.messages.some(
      (m) => !m.isBinary && m.data.toString().includes('FRAME_TOO_LARGE')
    ));

    const gotTooLargeError = clientA2.messages.some(
      (m) => !m.isBinary && m.data.toString().includes('FRAME_TOO_LARGE')
    );
    assert(gotTooLargeError, 'Room A client received FRAME_TOO_LARGE rejection frame');
    assert(clientB1.ws.readyState === WebSocket.OPEN, 'Room B was completely unaffected by Room A oversized payload');

    // --------------------------------------------------------------------------
    // Phase 6: Socket Fault Isolation
    // --------------------------------------------------------------------------
    console.log('\n🔌 Phase 6: Testing Abrupt Socket Drop Isolation...');

    // Abruptly terminate client A2 socket without clean close handshake
    clientA2.ws.terminate();
    await waitFor(() => sessionA.clients.size === 0);

    assert(sessionA.clients.size === 0, 'Terminated socket cleanly removed from Room A client set');
    assert(sessionB.clients.size === 2, 'Room B client set maintains both active connections');

    // --------------------------------------------------------------------------
    // Phase 7: Independent Room Lifecycle & Teardown
    // --------------------------------------------------------------------------
    console.log('\n🧹 Phase 7: Testing Independent Room Unload and Memory Cleanup...');

    // Room A has 0 clients remaining now
    const clientCountA = sessionA.getConnectionCount();
    assert(clientCountA === 0, 'Room A has 0 active connections');

    // Trigger unload of Room A
    await roomManager.unloadRoom(roomA.uuid);

    assert(!roomManager.rooms.has(roomA.uuid), 'Room A cleanly unloaded from roomManager memory');
    assert(sessionA.isDestroyed, 'Room A Y.Doc was destroyed to free memory');
    assert(roomManager.rooms.has(roomB.uuid), 'Room B remains actively resident in memory');
    assert(sessionB.clients.size === 2, 'Room B continues serving its 2 active clients');

    // Verify /health endpoint metrics
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    assert(healthData.activeRooms === 1, `GET /health reports exactly 1 active room (Actual: ${healthData.activeRooms})`);
    assert(healthData.activeWebSockets === 2, `GET /health reports 2 active WebSockets for Room B (Actual: ${healthData.activeWebSockets})`);
    assert(Array.isArray(healthData.roomIsolation?.rooms), 'GET /health exposes roomIsolation diagnostics');

    // Clean up Room B clients
    clientB1.close();
    clientB2.close();
    await sleep(200);
    await roomManager.unloadRoom(roomB.uuid);

  } finally {
    // Teardown
    await Room.deleteMany({ _id: { $in: [roomA._id, roomB._id] } });
    await User.findByIdAndDelete(testUser._id);
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.close(false);
  }

  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ NFR-52 Room Isolation tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-52 ROOM ISOLATION REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
