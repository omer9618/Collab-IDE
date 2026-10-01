/**
 * ==============================================================================
 * CollabIDE - NFR-36: WebSocket Connection Limits per Room Test Suite
 * ==============================================================================
 * Tests the requirement that:
 * "The server must enforce a maximum of 20 simultaneous WebSocket connections per room.
 * Connection attempts beyond this limit must be rejected with a clear error message.
 * This prevents a single room from consuming disproportionate server resources."
 *
 * Verification Phases:
 * 1. Environment Variable Tunability & Configuration Defaults
 * 2. Simultaneous Connections Under Limit (Normal Operation)
 * 3. Connection Rejection Beyond Limit (Code 1008 & Clear Error Message)
 * 4. Multi-Room Isolation (Room A at limit does not block Room B)
 * 5. Connection Slot Recovery on Disconnect (Immediate reuse of freed slot)
 * 6. Full 20-Connection Boundary Test (20 admitted, 21st rejected, disconnect -> 20th admitted)
 * 7. Health Check Metrics Observability (maxWsPerRoom & activeWebSockets in /health)
 * 8. Clean Graceful Teardown
 */

const path = require('path');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const { connectDB } = require('../config/db');
const User = require('../models/User');
const Room = require('../models/Room');
const { privateKey } = require('../utils/keys');

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

/**
 * Helper to establish a WebSocket client connection and capture message/close frames.
 */
function connectWsClient(serverUrl, roomUuid, token) {
  return new Promise((resolve) => {
    const wsUrl = `${serverUrl}/ws/${roomUuid}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    let errorPayload = null;
    let opened = false;
    let settled = false;

    function settle(res) {
      if (!settled) {
        settled = true;
        resolve(res);
      }
    }

    ws.on('open', () => {
      opened = true;
      // Allow 50ms for server to send immediate rejection frame or accept
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          settle({
            ws,
            opened: true,
            closed: false,
            code: null,
            reason: null,
            errorPayload,
          });
        }
      }, 50);
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'error') {
            errorPayload = parsed;
          }
        } catch (e) {
          // binary or non-json
        }
      }
    });

    ws.on('close', (code, reason) => {
      settle({
        ws,
        opened,
        closed: true,
        code,
        reason: reason ? reason.toString() : '',
        errorPayload,
      });
    });

    ws.on('error', (err) => {
      setTimeout(() => {
        settle({
          ws,
          opened,
          closed: true,
          code: null,
          reason: err.message,
          errorPayload,
        });
      }, 50);
    });

    // Hard fallback timeout: 5000ms
    setTimeout(() => {
      settle({
        ws,
        opened: ws.readyState === WebSocket.OPEN,
        closed: ws.readyState !== WebSocket.OPEN,
        code: null,
        reason: 'Connection timed out',
        errorPayload,
      });
    }, 5000);
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-36 WebSocket Connection Limits Automated Test');
  console.log('================================================================\n');

  // 1. Connect DB
  await connectDB();
  const mongoose = require('mongoose');
  assert(mongoose.connection.readyState === 1, 'Connected to MongoDB Atlas');

  // 2. Start server on an isolated port
  const testPort = 3196;
  const { server } = require('../server');
  if (!server.listening) {
    await new Promise((resolve) => server.listen(testPort, resolve));
  }
  const baseUrl = `http://localhost:${testPort}`;
  const wsBaseUrl = `ws://localhost:${testPort}`;
  console.log(`📡 Test server listening on ${baseUrl}\n`);

  // 3. Create test fixtures (User and Rooms)
  const timestamp = Date.now();
  const testUser = await User.create({
    email: `ws-limit-tester-${timestamp}@example.com`,
    password: 'Password123!',
    displayName: 'WS Limit Tester',
    avatarColor: '#89b4fa',
    isVerified: true,
  });

  const validToken = jwt.sign({ userId: testUser._id, type: 'access' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '1h',
  });

  const roomA = await Room.create({
    name: 'WS Limit Room A',
    uuid: `test-room-a-${timestamp}`,
    owner: testUser._id,
    participants: [{ user: testUser._id, role: 'Owner' }],
    files: [{ name: 'main.js', content: '// Room A' }],
  });

  const roomB = await Room.create({
    name: 'WS Limit Room B',
    uuid: `test-room-b-${timestamp}`,
    owner: testUser._id,
    participants: [{ user: testUser._id, role: 'Owner' }],
    files: [{ name: 'main.js', content: '// Room B' }],
  });

  const activeSockets = [];

  try {
    // --------------------------------------------------------------------------
    // Phase 1: Environment Variable Tunability & Defaults
    // --------------------------------------------------------------------------
    console.log('⚙️ Phase 1: Verifying Configuration Defaults & Environment Tunability...');
    delete process.env.MAX_WS_PER_ROOM;
    delete process.env.ROOM_WS_LIMIT;

    const initialHealthRes = await fetch(`${baseUrl}/health`);
    const initialHealth = await initialHealthRes.json();
    assert(initialHealth.maxWsPerRoom === 20, `Default maxWsPerRoom is 20 (Actual: ${initialHealth.maxWsPerRoom})`);

    // Tune limit dynamically to 3
    process.env.MAX_WS_PER_ROOM = '3';
    const tunedHealthRes = await fetch(`${baseUrl}/health`);
    const tunedHealth = await tunedHealthRes.json();
    assert(tunedHealth.maxWsPerRoom === 3, `Tuned maxWsPerRoom via MAX_WS_PER_ROOM reflects 3 (Actual: ${tunedHealth.maxWsPerRoom})`);

    // --------------------------------------------------------------------------
    // Phase 2: Connections Under Limit (Limit = 3)
    // --------------------------------------------------------------------------
    console.log('\n🔌 Phase 2: Connecting Sockets Up to Configured Limit (Limit = 3)...');
    
    // Connect client 1
    const conn1 = await connectWsClient(wsBaseUrl, roomA.uuid, validToken);
    assert(conn1.opened && !conn1.closed, 'Connection 1/3 to Room A admitted and opened');
    if (conn1.ws) activeSockets.push(conn1.ws);

    // Connect client 2
    const conn2 = await connectWsClient(wsBaseUrl, roomA.uuid, validToken);
    assert(conn2.opened && !conn2.closed, 'Connection 2/3 to Room A admitted and opened');
    if (conn2.ws) activeSockets.push(conn2.ws);

    // Connect client 3
    const conn3 = await connectWsClient(wsBaseUrl, roomA.uuid, validToken);
    assert(conn3.opened && !conn3.closed, 'Connection 3/3 to Room A admitted and opened');
    if (conn3.ws) activeSockets.push(conn3.ws);

    // --------------------------------------------------------------------------
    // Phase 3: Connection Rejection Beyond Limit
    // --------------------------------------------------------------------------
    console.log('\n🚫 Phase 3: Verifying Rejection on Connection 4 (Exceeding Limit 3)...');
    const conn4 = await connectWsClient(wsBaseUrl, roomA.uuid, validToken);

    assert(conn4.closed === true, 'Connection 4 to Room A is immediately closed by server');
    assert(conn4.code === 1008, `Server closed with RFC 6455 status code 1008 Policy Violation (Actual: ${conn4.code})`);
    assert(
      conn4.reason.includes('Room capacity exceeded') && conn4.reason.includes('3'),
      `Close reason contains clear error message: "${conn4.reason}"`
    );
    assert(
      conn4.errorPayload && conn4.errorPayload.code === 'ROOM_CAPACITY_EXCEEDED',
      'Client received JSON text frame with code: "ROOM_CAPACITY_EXCEEDED"'
    );
    assert(
      conn4.errorPayload && conn4.errorPayload.limit === 3,
      `Error payload reports limit: 3 (Actual: ${conn4.errorPayload?.limit})`
    );

    // --------------------------------------------------------------------------
    // Phase 4: Multi-Room Isolation
    // --------------------------------------------------------------------------
    console.log('\n🏢 Phase 4: Verifying Multi-Room Isolation (Room B admits connections while Room A is full)...');
    const connB1 = await connectWsClient(wsBaseUrl, roomB.uuid, validToken);
    assert(connB1.opened && !connB1.closed, 'Connection 1 to Room B admitted successfully while Room A is at capacity');
    if (connB1.ws) activeSockets.push(connB1.ws);

    // --------------------------------------------------------------------------
    // Phase 5: Slot Recovery on Disconnect
    // --------------------------------------------------------------------------
    console.log('\n🔄 Phase 5: Verifying Connection Slot Recovery Upon Disconnect...');
    // Disconnect conn1 from Room A
    conn1.ws.close();
    // Wait for close event to register on server
    await new Promise((r) => setTimeout(r, 200));

    // Now Room A has 2 active connections. New connection attempt should succeed!
    const connRecovered = await connectWsClient(wsBaseUrl, roomA.uuid, validToken);
    assert(connRecovered.opened && !connRecovered.closed, 'New connection admitted immediately into freed slot (now 3/3)');
    if (connRecovered.ws) activeSockets.push(connRecovered.ws);

    // Next connection should be rejected again
    const connAgainOver = await connectWsClient(wsBaseUrl, roomA.uuid, validToken);
    assert(connAgainOver.closed === true, 'Subsequent 4th connection is rejected again');
    assert(connAgainOver.code === 1008, 'Rejection maintains code 1008');

    // --------------------------------------------------------------------------
    // Phase 6: Full 20-Connection Boundary Test (NFR-36 Specification Limit)
    // --------------------------------------------------------------------------
    console.log('\n🎯 Phase 6: Verifying Full 20-Connection Simultaneous Boundary (NFR-36 Spec)...');
    
    // Set limit to standard 20
    process.env.MAX_WS_PER_ROOM = '20';

    const room20 = await Room.create({
      name: 'WS Limit Room 20',
      uuid: `test-room-20-${timestamp}`,
      owner: testUser._id,
      participants: [{ user: testUser._id, role: 'Owner' }],
      files: [{ name: 'main.js', content: '// 20 Boundary Test' }],
    });

    console.log('  ⚡ Connecting 20 simultaneous WebSocket clients to test-room-20...');
    const sockets20 = [];
    for (let i = 1; i <= 20; i++) {
      const conn = await connectWsClient(wsBaseUrl, room20.uuid, validToken);
      if (conn.opened && !conn.closed) {
        sockets20.push(conn.ws);
        activeSockets.push(conn.ws);
      } else {
        console.error(`  ❌ Failed to admit connection ${i}/20:`, conn.code, conn.reason);
      }
    }

    assert(sockets20.length === 20, `Successfully connected all 20 simultaneous WebSockets to room (Count: ${sockets20.length})`);

    // Attempt 21st connection
    console.log('  ⚡ Attempting 21st connection to full 20-client room...');
    const conn21 = await connectWsClient(wsBaseUrl, room20.uuid, validToken);
    assert(conn21.closed === true, 'Connection 21/20 is rejected');
    assert(conn21.code === 1008, 'Connection 21 receives RFC 6455 code 1008 Policy Violation');
    assert(
      conn21.reason.includes('Room capacity exceeded (maximum 20 connections per room)'),
      `Connection 21 receives exact clear error message: "${conn21.reason}"`
    );
    assert(
      conn21.errorPayload && conn21.errorPayload.limit === 20 && conn21.errorPayload.current === 20,
      'Error payload reports limit: 20 and current: 20'
    );

    // Free 1 connection from the 20
    const freedSocket = sockets20.pop();
    freedSocket.close();
    await new Promise((r) => setTimeout(r, 200));

    // Re-attempt 21st (now 20th)
    const conn20Replacement = await connectWsClient(wsBaseUrl, room20.uuid, validToken);
    assert(conn20Replacement.opened && !conn20Replacement.closed, 'New client successfully joins room at slot 20 after client departs');
    if (conn20Replacement.ws) activeSockets.push(conn20Replacement.ws);

    // --------------------------------------------------------------------------
    // Phase 7: Health Endpoint Metrics Observability (NFR-39)
    // --------------------------------------------------------------------------
    console.log('\n🏥 Phase 7: Verifying /health Endpoint WebSocket Observability...');
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();

    assert(healthData.maxWsPerRoom === 20, `health.maxWsPerRoom reports 20 (Actual: ${healthData.maxWsPerRoom})`);
    assert(typeof healthData.activeWebSockets === 'number', 'health.activeWebSockets is a number');
    assert(healthData.activeWebSockets >= 20, `health.activeWebSockets tracks active sockets (Actual: ${healthData.activeWebSockets})`);

    // --------------------------------------------------------------------------
    // Phase 8: Clean Teardown
    // --------------------------------------------------------------------------
    console.log('\n🧹 Phase 8: Performing Clean Teardown...');
    for (const ws of activeSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    await new Promise((r) => setTimeout(r, 300));

    await Room.deleteMany({ uuid: { $in: [roomA.uuid, roomB.uuid, room20.uuid] } });
    await User.deleteOne({ _id: testUser._id });
    console.log('  ✅ Cleaned up MongoDB test fixtures');

  } catch (err) {
    console.error('❌ Unexpected test error:', err);
    failedTests++;
  } finally {
    // Close server
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.close(false);
    console.log('  ✅ Closed test server and MongoDB connection');
  }

  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ NFR-36 WebSocket Connection Limits tests failed!\n');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-36 WEBSOCKET CONNECTION LIMITS REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTestSuite();
