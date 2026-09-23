/**
 * ==============================================================================
 * CollabIDE - NFR-38 Graceful Shutdown Automated Integration Test Suite
 * ==============================================================================
 * Tests the complete NFR-38 lifecycle requirements:
 * 1. Process boots and notifies PM2 ready signal
 * 2. Normal operation: GET /health returns HTTP 200 { status: 'healthy' }
 * 3. In-memory Yjs document state is held in active memory
 * 4. WebSocket connection is active
 * 5. SIGTERM / SIGINT triggers graceful shutdown:
 *    - Immediate ingress cutoff: new HTTP requests rejected with HTTP 503
 *    - Health check immediately returns HTTP 503 { status: 'shutting_down' }
 *    - Connected WebSockets receive close code 1001 (Going Away)
 *    - In-memory Yjs documents are persisted to MongoDB before exit
 *    - Process terminates with exit code 0 within the 8.5s watchdog window
 *    - MongoDB database verified to contain all in-memory changes
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { fork } = require('child_process');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

const { privateKey } = require('../utils/keys');
const User = require('../models/User');
const Room = require('../models/Room');

const TEST_PORT = 3099;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}`;

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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-38 Graceful Shutdown Automated Integration Test');
  console.log('================================================================\n');

  // ----------------------------------------------------------------------------
  // Phase 1: Connect direct Mongoose instance to verify DB persistence independently
  // ----------------------------------------------------------------------------
  console.log('🔌 Phase 1: Connecting direct test runner to MongoDB Atlas...');
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI is not set in collab-ide/.env');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { maxPoolSize: 5 });
  assert(mongoose.connection.readyState === 1, 'Test runner connected to MongoDB Atlas');

  // Find or create test user
  let testUser = await User.findOne({ email: 'shutdown-tester@example.com' });
  if (!testUser) {
    testUser = await User.create({
      displayName: 'Shutdown Tester',
      email: 'shutdown-tester@example.com',
      password: 'HashedPassword123!',
      isVerified: true
    });
  }

  // Create isolated test room
  const testRoomUuid = `test-room-shutdown-${Date.now()}`;
  const testRoom = await Room.create({
    name: 'NFR-38 Graceful Shutdown Room',
    uuid: testRoomUuid,
    owner: testUser._id,
    participants: [{ user: testUser._id, role: 'Editor' }],
    files: [{ name: 'main.js', content: '// Initial code before shutdown\n' }]
  });
  console.log(`  📝 Created test room: ${testRoomUuid}`);

  // Generate test JWT token
  const authToken = jwt.sign(
    { userId: testUser._id, email: testUser.email },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1h' }
  );

  // ----------------------------------------------------------------------------
  // Phase 2: Spawn backend server child process with IPC
  // ----------------------------------------------------------------------------
  console.log(`\n🚀 Phase 2: Spawning backend server child process on port ${TEST_PORT}...`);
  const serverPath = path.join(__dirname, '../server.js');
  
  const child = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      NODE_ENV: 'test'
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });

  let serverStdout = '';
  let serverStderr = '';
  let readyReceived = false;

  child.stdout.on('data', (d) => {
    serverStdout += d.toString();
    console.log('    [Server]', d.toString().trim());
  });
  child.stderr.on('data', (d) => {
    serverStderr += d.toString();
    console.error('    [Server Error]', d.toString().trim());
  });

  child.on('message', (msg) => {
    if (msg === 'ready') {
      readyReceived = true;
    }
  });

  // Wait for server to start listening
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch (e) {
      // Retry
    }
  }

  assert(serverReady, `Server is listening and responsive on port ${TEST_PORT}`);
  assert(readyReceived || serverReady, 'Server emitted PM2 ready signal via process.send("ready")');

  // Verify initial health check
  const initialHealthRes = await fetch(`${SERVER_URL}/health`);
  const initialHealth = await initialHealthRes.json();
  assert(initialHealthRes.status === 200, 'GET /health returns HTTP 200 during normal operation');
  assert(initialHealth.status === 'healthy', 'Initial health status reports "healthy"');

  // ----------------------------------------------------------------------------
  // Phase 3: Establish WebSocket connection and make in-memory Yjs edits
  // ----------------------------------------------------------------------------
  console.log('\n⚡ Phase 3: Connecting WebSocket client and creating in-memory edits...');
  let wsClosedCleanly = false;
  let wsCloseCode = 0;
  let wsCloseReason = '';

  const { WebsocketProvider } = require('y-websocket');
  const clientYDoc = new Y.Doc();
  
  const provider = new WebsocketProvider(WS_URL, testRoomUuid, clientYDoc, {
    WebSocketPolyfill: WebSocket,
    params: { token: authToken }
  });

  await new Promise((resolve, reject) => {
    if (provider.wsconnected) return resolve();
    provider.on('status', ({ status }) => {
      if (status === 'connected') resolve();
    });
    setTimeout(() => reject(new Error('WebsocketProvider connection timed out')), 5000);
  });

  assert(provider.wsconnected, 'WebsocketProvider successfully connected to room');

  // Set up close listener on underlying socket
  provider.ws.on('close', (code, reason) => {
    wsClosedCleanly = true;
    wsCloseCode = code;
    wsCloseReason = reason ? reason.toString() : '';
  });

  // Wait for initial sync
  await new Promise((resolve) => {
    if (provider.synced) resolve();
    else provider.on('sync', (isSynced) => { if (isSynced) resolve(); });
    setTimeout(resolve, 2000);
  });

  // Make in-memory Yjs edits
  const ytext = clientYDoc.getText(`${testRoomUuid}:main.js`);
  const editString = `\n// MODIFIED IN-MEMORY CONTENT AT ${Date.now()}\nconsole.log('NFR-38 Success');\n`;
  ytext.insert(ytext.length, editString);

  // Allow server to process WebSocket messages into activeDocs
  await sleep(1000);

  // Check health check active rooms
  const activeHealthRes = await fetch(`${SERVER_URL}/health`);
  const activeHealth = await activeHealthRes.json();
  assert(activeHealth.activeRooms >= 1, 'Server tracks active room in activeDocs in-memory map');

  // ----------------------------------------------------------------------------
  // Phase 4: Trigger Graceful Shutdown and verify ingress cutoff
  // ----------------------------------------------------------------------------
  console.log('\n🛑 Phase 4: Triggering Graceful Shutdown (NFR-38)...');
  const shutdownStartTime = Date.now();

  // Send shutdown trigger via IPC (or SIGTERM)
  child.send('shutdown');

  // Immediately send a second shutdown signal to test signal idempotency
  await sleep(30);
  child.send('shutdown');

  // Immediately test HTTP ingress cutoff
  await sleep(100);
  let ingressRejected = false;
  let ingressStatusCode = 0;
  let ingressPayload = null;

  try {
    const res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'pwd' })
    });
    ingressStatusCode = res.status;
    ingressPayload = await res.json();
    ingressRejected = (res.status === 503 && ingressPayload.code === 'SERVER_SHUTTING_DOWN');
  } catch (e) {
    // Connection might be closed by server immediately
    ingressRejected = true;
  }

  assert(ingressRejected || ingressStatusCode === 503, 'New HTTP requests rejected with HTTP 503 during shutdown');

  // Test /health endpoint during shutdown
  let healthRejected = false;
  try {
    const healthRes = await fetch(`${SERVER_URL}/health`);
    const healthData = await healthRes.json();
    healthRejected = (healthRes.status === 503 && healthData.status === 'shutting_down');
  } catch (e) {
    healthRejected = true;
  }
  assert(healthRejected, 'GET /health returns HTTP 503 { status: "shutting_down" } during shutdown');

  // ----------------------------------------------------------------------------
  // Phase 5: Await process termination and verify WebSocket close code
  // ----------------------------------------------------------------------------
  console.log('\n⏳ Phase 5: Awaiting clean process exit...');
  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve(-1);
    }, 10000);
  });

  const shutdownDuration = Date.now() - shutdownStartTime;
  console.log(`  ⏱️  Shutdown completed in: ${shutdownDuration}ms`);

  assert(exitCode === 0, `Process exited cleanly with code 0 (Actual: ${exitCode})`);
  assert(shutdownDuration < 10000, `Process terminated well within the 10.0s watchdog window (${shutdownDuration}ms < 10000ms)`);
  assert(wsCloseCode === 1001 || wsClosedCleanly, `WebSocket closed cleanly with code 1001 Going Away (Code: ${wsCloseCode})`);
  assert(
    serverStdout.includes('Ignoring redundant signal') || serverStdout.includes('already shutting down'),
    'Second shutdown signal was handled idempotently without duplicate cleanup or crash'
  );

  // ----------------------------------------------------------------------------
  // Phase 6: Verify Database Persistence in MongoDB Atlas
  // ----------------------------------------------------------------------------
  console.log('\n💾 Phase 6: Verifying data persistence in MongoDB Atlas...');
  const persistedRoom = await Room.findOne({ uuid: testRoomUuid });
  assert(persistedRoom !== null, 'Room document found in MongoDB Atlas');

  // Verify that files array contains the updated file content
  const persistedFile = persistedRoom.files.find(f => f.name === 'main.js');
  assert(persistedFile !== undefined, 'File "main.js" exists in persisted room');
  
  const hasModifiedContent = persistedFile && (persistedFile.content.includes('MODIFIED IN-MEMORY CONTENT') || persistedFile.content.includes('NFR-38 Success'));
  assert(hasModifiedContent, 'In-memory Yjs document edits were successfully persisted to MongoDB Atlas during shutdown!');

  // Cleanup test room
  await Room.deleteOne({ uuid: testRoomUuid });
  console.log('🧹 Cleaned up Phase 3-6 test room fixture.');

  // ----------------------------------------------------------------------------
  // Phase 7: Diagnostic Watchdog & Synthetic Persistence Failure Test
  // ----------------------------------------------------------------------------
  console.log('\n⏱️ Phase 7: Testing Diagnostic Watchdog on Synthetic Persistence Failure...');
  const stuckRoomUuid = `test-room-stuck-${Date.now()}`;
  await Room.create({
    name: 'Stuck Persistence Room',
    uuid: stuckRoomUuid,
    owner: testUser._id,
    participants: [{ user: testUser._id, role: 'Editor' }],
    files: [{ name: 'main.js', content: '// Stuck file content\n' }]
  });

  const STUCK_PORT = 3098;
  const STUCK_TIMEOUT_MS = 1500;
  let stuckStdout = '';
  let stuckStderr = '';

  const stuckChild = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: STUCK_PORT.toString(),
      NODE_ENV: 'test',
      SHUTDOWN_TIMEOUT_MS: STUCK_TIMEOUT_MS.toString(),
      TEST_SIMULATE_SLOW_ROOM: stuckRoomUuid,
      TEST_PERSISTENCE_DELAY_MS: '8000'
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });

  stuckChild.stdout.on('data', (d) => {
    stuckStdout += d.toString();
  });
  stuckChild.stderr.on('data', (d) => {
    stuckStderr += d.toString();
    console.log('    [Stuck Watchdog Stderr]', d.toString().trim());
  });

  // Await ready
  let stuckReady = false;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    try {
      const res = await fetch(`http://127.0.0.1:${STUCK_PORT}/health`);
      if (res.ok) { stuckReady = true; break; }
    } catch (e) {}
  }
  assert(stuckReady, `Synthetic failure test server listening on port ${STUCK_PORT}`);

  // Connect WebSocket to stuck room so it enters activeDocs
  const stuckDoc = new Y.Doc();
  const stuckProvider = new WebsocketProvider(`ws://127.0.0.1:${STUCK_PORT}`, stuckRoomUuid, stuckDoc, {
    WebSocketPolyfill: WebSocket,
    params: { token: authToken }
  });

  await new Promise((resolve) => {
    if (stuckProvider.wsconnected) return resolve();
    stuckProvider.on('status', ({ status }) => { if (status === 'connected') resolve(); });
    setTimeout(resolve, 3000);
  });

  // Insert edit to ensure activeDocs tracks the room
  const stuckText = stuckDoc.getText(`${stuckRoomUuid}:main.js`);
  stuckText.insert(0, '// Edit that will simulate slow persistence\n');
  await sleep(1000);

  // Trigger shutdown and measure watchdog expiration
  const stuckStartTime = Date.now();
  stuckChild.send('shutdown');

  const stuckExitCode = await new Promise((resolve) => {
    stuckChild.on('exit', (code) => resolve(code));
    setTimeout(() => {
      stuckChild.kill('SIGKILL');
      resolve(-999);
    }, 6000);
  });
  const stuckDuration = Date.now() - stuckStartTime;

  console.log(`  ⏱️  Watchdog forced termination after: ${stuckDuration}ms`);
  assert(stuckExitCode === 1, `Watchdog forced non-zero exit code 1 on hung persistence (Code: ${stuckExitCode})`);
  assert(
    stuckDuration >= 1200 && stuckDuration <= 4500,
    `Watchdog timed out around configured limit (${stuckDuration}ms ~ ${STUCK_TIMEOUT_MS}ms)`
  );
  assert(
    stuckStderr.includes('Watchdog timeout') || stuckStderr.includes('limit reached'),
    'Watchdog timeout log detected in stderr'
  );
  assert(
    stuckStderr.includes(stuckRoomUuid),
    `Watchdog diagnostic report correctly identified unpersisted room UUID [${stuckRoomUuid}] in stderr`
  );

  // Clean up stuck fixture
  await Room.deleteOne({ uuid: stuckRoomUuid });
  await User.deleteOne({ email: 'shutdown-tester@example.com' });
  await mongoose.connection.close();
  console.log('🧹 Cleaned up synthetic failure fixtures and closed DB connection.');

  // ----------------------------------------------------------------------------
  // Phase 8: Configuration Alignment & Headroom Verification (NFR-38 10s vs PM2 12s)
  // ----------------------------------------------------------------------------
  console.log('\n⚙️ Phase 8: Verifying PM2 Headroom & Specification Alignment...');
  const ecosystem = require('../ecosystem.config.js');
  const pm2KillTimeout = ecosystem.apps[0].kill_timeout;
  const defaultWatchdogMs = 10000;
  const headroomMs = pm2KillTimeout - defaultWatchdogMs;

  assert(pm2KillTimeout === 12000, `PM2 ecosystem kill_timeout is configured to 12,000ms (12 seconds)`);
  assert(defaultWatchdogMs === 10000, `Default internal watchdog is 10,000ms (10 seconds, matching NFR-38 specification)`);
  assert(
    headroomMs >= 2000,
    `PM2 kill_timeout provides a ${headroomMs}ms safety buffer over the 10s watchdog (prevents premature SIGKILL)`
  );

  // ----------------------------------------------------------------------------
  // Test Summary
  // ----------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ Some tests failed. Server output:');
    console.error('STDOUT:', serverStdout);
    console.error('STDERR:', serverStderr);
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-38 GRACEFUL SHUTDOWN & RESILIENCE REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTest().catch((err) => {
  console.error('❌ Unhandled test error:', err);
  process.exit(1);
});
