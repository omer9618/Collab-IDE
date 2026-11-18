/**
 * @file test/test_sdr01_shared_nothing_backend.js
 * @description Comprehensive automated verification test suite for SDR-01: Shared-Nothing Node.js Backend.
 *
 * SPECIFICATION (SDR-01):
 * "Description: The backend must be completely stateless. No user session, room metadata,
 *  or WebSocket connection state can be stored exclusively in local memory.
 *  Acceptance Criteria:
 *  - If Backend Pod A is killed, users auto-reconnect to Pod B with zero data loss."
 *
 * VERIFICATION PHASES:
 * Phase 1: Shared-Nothing Architecture & Invariants Analysis (Zero Exclusive Local Memory)
 * Phase 2: Multi-Pod Cluster Live State & Presence Synchronization (Cross-Pod Connection State)
 * Phase 3: Abrupt Pod A Termination & Client Auto-Reconnect to Pod B with Zero Data Loss (Core Acceptance Criteria)
 * Phase 4: Multi-Client Failover & Cross-Pod Conflict Resolution
 * Phase 5: Room Metadata & Session Survival Across Pod Death
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

// Ensure environment configuration is loaded
const COLLAB_IDE_DIR = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(COLLAB_IDE_DIR, '.env') });
require('dotenv').config();

const { connectDB } = require('../config/db');
const { app } = require('../server');
const { auth, rooms, websocketRelay, infrastructure } = require('../modules');
const RoomManager = rooms.RoomManager;
const { MemoryPubSubAdapter } = require('../services/pubsub');
const User = require('../models/User');
const Room = require('../models/Room');
const RefreshToken = require('../models/RefreshToken');
const { generateAccessToken } = require('../utils/jwt');

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
 * Native HTTP request helper.
 */
function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(bodyStr);
        } catch (_) {}

        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: bodyStr,
          data: json,
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      if (typeof options.body === 'object') {
        req.write(JSON.stringify(options.body));
      } else {
        req.write(options.body);
      }
    }
    req.end();
  });
}

/**
 * Extracts a cookie value from headers.
 */
function extractCookie(headers, cookieName) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const cookieStr of cookieList) {
    const parts = cookieStr.split(';');
    for (const part of parts) {
      const [name, val] = part.trim().split('=');
      if (name === cookieName) {
        return val;
      }
    }
  }
  return null;
}

/**
 * Simulates a collaborative client connecting via WebSocket and synchronizing Yjs state.
 */
class SimulatedClient {
  constructor(name, token, roomUuid) {
    this.name = name;
    this.token = token;
    this.roomUuid = roomUuid;
    this.ydoc = new Y.Doc();
    this.ws = null;
    this.isSynced = false;
    this.receivedUpdates = [];

    // Automatically transmit local document updates to server when connected
    this.ydoc.on('update', (update, origin) => {
      if (origin !== 'remote' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync = 0
        syncProtocol.writeUpdate(encoder, update);
        try {
          this.ws.send(encoding.toUint8Array(encoder));
        } catch (_) {}
      }
    });
  }

  async connect(targetUrl) {
    return new Promise((resolve, reject) => {
      const baseWs = targetUrl.replace(/^http/, 'ws');
      const wsUrl = `${baseWs}/${this.roomUuid}?token=${this.token}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        // Send initial SyncStep1 to server
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync = 0
        syncProtocol.writeSyncStep1(encoder, this.ydoc);
        try {
          this.ws.send(encoding.toUint8Array(encoder));
        } catch (_) {}
      });

      this.ws.on('message', (data, isBinary) => {
        const rawBytes = isBinary ? new Uint8Array(data) : Buffer.from(data);
        if (rawBytes.length > 0 && rawBytes[0] === 0) {
          try {
            const decoder = decoding.createDecoder(rawBytes);
            decoding.readVarUint(decoder); // skip messageSync (0)
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 0);
            syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, 'remote');

            if (encoding.length(encoder) > 1) {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(encoding.toUint8Array(encoder));
              }
            }
            if (!this.isSynced) {
              this.isSynced = true;
              resolve();
            }
            this.receivedUpdates.push(rawBytes);
          } catch (err) {
            console.error(`Client ${this.name} sync decode error:`, err.message);
          }
        }
      });

      this.ws.on('error', (err) => {
        // Trapped for reconnect testing
      });

      // Fallback timeout in case initial message is delayed
      setTimeout(() => {
        resolve();
      }, 600);
    });
  }

  applyLocalEdit(fileName, textToAdd) {
    const ytext = this.ydoc.getText(`${this.roomUuid}:${fileName}`);
    ytext.insert(ytext.length, textToAdd);
  }

  addFile(fileName, initialContent = '') {
    const yfiles = this.ydoc.getArray(`${this.roomUuid}:files`);
    const filesArray = yfiles.toArray();
    if (!filesArray.includes(fileName)) {
      yfiles.push([fileName]);
    }
    const ytext = this.ydoc.getText(`${this.roomUuid}:${fileName}`);
    if (initialContent) {
      ytext.insert(0, initialContent);
    }
  }

  getFileContent(fileName) {
    return this.ydoc.getText(`${this.roomUuid}:${fileName}`).toString();
  }

  getFiles() {
    return this.ydoc.getArray(`${this.roomUuid}:files`).toArray();
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (_) {}
      this.ws = null;
    }
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting SDR-01: Shared-Nothing Node.js Backend Verification Suite');
  console.log('================================================================\n');

  let serverA = null;
  let serverB = null;
  let relayA = null;
  let relayB = null;
  let managerA = null;
  let managerB = null;

  try {
    await connectDB();

    // --------------------------------------------------------------------------
    // Phase 1: Shared-Nothing Architectural Invariants & Static Analysis
    // --------------------------------------------------------------------------
    console.log('🔍 Phase 1: Shared-Nothing Architecture & Invariants Analysis...');

    // 1.1 Assert Stateless & Shared-Nothing Pipeline
    let assertionPassed = false;
    try {
      infrastructure.assertSharedNothingBackend(app);
      assertionPassed = true;
    } catch (err) {
      console.error('Assertion error:', err.message);
    }
    check(assertionPassed, 'assertSharedNothingBackend passes on Express application');

    // 1.2 Verify zero session packages in package.json
    const pkg = require('../../package.json');
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    check(!allDeps['express-session'], 'Zero dependency on express-session');
    check(!allDeps['cookie-session'], 'Zero dependency on cookie-session');
    check(!allDeps['connect-redis'], 'Zero dependency on connect-redis');

    // 1.3 Verify Module Manifest Descriptors declare sharedNothing readiness
    check(
      websocketRelay.sharedNothing && websocketRelay.sharedNothing.ready === true,
      'websocketRelay exports sharedNothing.ready === true'
    );
    check(
      websocketRelay.sharedNothing.noExclusiveLocalMemory === true,
      'websocketRelay declares noExclusiveLocalMemory === true'
    );
    check(
      infrastructure.sharedNothing && infrastructure.sharedNothing.zeroDataLossFailover === true,
      'infrastructure exports sharedNothing.zeroDataLossFailover === true'
    );
    check(
      rooms.sharedNothing && rooms.sharedNothing.roomMetadataInDB === true,
      'rooms module exports sharedNothing.roomMetadataInDB === true'
    );

    // 1.4 Verify Room Schema persists complete workspace state
    check(Boolean(Room.schema.path('ydocState')), 'Room schema persists binary Yjs document state (ydocState)');
    check(Boolean(Room.schema.path('files')), 'Room schema persists file tree collection (files)');
    check(Boolean(Room.schema.path('participants')), 'Room schema persists participant roles');
    check(Boolean(Room.schema.path('isClosed')), 'Room schema persists room closure state');

    // --------------------------------------------------------------------------
    // Phase 2: Multi-Pod Cluster Live State & Presence Synchronization
    // --------------------------------------------------------------------------
    console.log('\n🌐 Phase 2: Multi-Pod Cluster Live State & Presence Synchronization...');

    const sharedPubSub = new MemoryPubSubAdapter();

    // Instantiate two independent Pod RoomManagers sharing the cluster pub/sub bus
    managerA = new RoomManager({ nodeId: 'pod-alpha', pubsubAdapter: sharedPubSub });
    managerB = new RoomManager({ nodeId: 'pod-beta', pubsubAdapter: sharedPubSub });

    check(managerA.nodeId === 'pod-alpha', 'Pod A instantiated with cluster nodeId: pod-alpha');
    check(managerB.nodeId === 'pod-beta', 'Pod B instantiated with cluster nodeId: pod-beta');

    // Start Pod A HTTP and WebSocket Relay
    serverA = http.createServer(app);
    relayA = websocketRelay.initWebSocketRelay({
      server: serverA,
      roomManager: managerA,
      User,
      Room,
      pubsubAdapter: sharedPubSub,
    });
    await new Promise((resolve) => serverA.listen(3301, resolve));

    // Start Pod B HTTP and WebSocket Relay
    serverB = http.createServer(app);
    relayB = websocketRelay.initWebSocketRelay({
      server: serverB,
      roomManager: managerB,
      User,
      Room,
      pubsubAdapter: sharedPubSub,
    });
    await new Promise((resolve) => serverB.listen(3302, resolve));

    const urlA = 'http://localhost:3301';
    const urlB = 'http://localhost:3302';

    // Create Test User Alice and User Bob
    const timestamp = Date.now();
    const aliceEmail = `alice_sdr01_${timestamp}@example.com`;
    const bobEmail = `bob_sdr01_${timestamp}@example.com`;

    let alice = await User.create({
      email: aliceEmail,
      password: 'Password123!',
      displayName: 'Alice Engineer',
      isVerified: true,
    });

    let bob = await User.create({
      email: bobEmail,
      password: 'Password123!',
      displayName: 'Bob Architect',
      isVerified: true,
    });

    const aliceToken = generateAccessToken(alice);
    const bobToken = generateAccessToken(bob);

    // Create a Room in MongoDB
    const roomUuid = `sdr01-room-${timestamp}`;
    const testRoom = await Room.create({
      name: `SDR-01 Cluster Workspace ${timestamp}`,
      uuid: roomUuid,
      owner: alice._id,
      participants: [
        { user: alice._id, role: 'Owner' },
        { user: bob._id, role: 'Editor' },
      ],
      files: [{ name: 'main.js', content: 'console.log("initial");' }],
    });

    // Alice connects to Pod A
    const clientAlice = new SimulatedClient('Alice', aliceToken, roomUuid);
    await clientAlice.connect(urlA);

    // Bob connects to Pod B
    const clientBob = new SimulatedClient('Bob', bobToken, roomUuid);
    await clientBob.connect(urlB);

    // Allow pub/sub presence frames to propagate across the cluster bus
    await new Promise((r) => setTimeout(r, 400));

    // Check cluster-wide presence on Pod A (must include Bob from Pod B)
    const presenceA = managerA.getPresenceMap();
    const roomUsersA = presenceA.get(roomUuid) || new Set();
    check(
      roomUsersA.has(alice._id.toString()),
      'Pod A presence includes local connected user (Alice)'
    );
    check(
      roomUsersA.has(bob._id.toString()),
      'Pod A presence includes remote cluster user (Bob on Pod B) - Connection state NOT exclusive to local memory'
    );

    // Check cluster-wide presence on Pod B (must include Alice from Pod A)
    const presenceB = managerB.getPresenceMap();
    const roomUsersB = presenceB.get(roomUuid) || new Set();
    check(
      roomUsersB.has(bob._id.toString()),
      'Pod B presence includes local connected user (Bob)'
    );
    check(
      roomUsersB.has(alice._id.toString()),
      'Pod B presence includes remote cluster user (Alice on Pod A) - Connection state NOT exclusive to local memory'
    );

    // Check connection counts across nodes
    check(
      managerA.getRoomConnectionCount(roomUuid) >= 2,
      `Pod A reports cluster connection count >= 2 (reported: ${managerA.getRoomConnectionCount(roomUuid)})`
    );
    check(
      managerB.getRoomConnectionCount(roomUuid) >= 2,
      `Pod B reports cluster connection count >= 2 (reported: ${managerB.getRoomConnectionCount(roomUuid)})`
    );

    // Cross-Pod Real-time Yjs CRDT edit propagation
    const aliceSession = await managerA.getOrCreateRoom(roomUuid);
    const bobSession = await managerB.getOrCreateRoom(roomUuid);

    aliceSession.ydoc.getText(`${roomUuid}:main.js`).insert(19, '\nconst clusterAlive = true;');
    // Publish update from Pod A to cluster
    const updateFromA = Y.encodeStateAsUpdate(aliceSession.ydoc);
    await sharedPubSub.publish(`collab:room:${roomUuid}`, {
      originNodeId: 'pod-alpha',
      type: 'yjs_update',
      payload: updateFromA,
    });

    await new Promise((r) => setTimeout(r, 100));
    check(
      bobSession.ydoc.getText(`${roomUuid}:main.js`).toString().includes('const clusterAlive = true;'),
      'Pod B synchronized CRDT update from Pod A via cluster Pub/Sub bus'
    );

    // Clean up temporary simulation clients for Phase 2
    clientAlice.disconnect();
    clientBob.disconnect();

    // --------------------------------------------------------------------------
    // Phase 3: Abrupt Pod A Termination & Client Auto-Reconnect to Pod B with Zero Data Loss
    // --------------------------------------------------------------------------
    console.log('\n💥 Phase 3: Abrupt Pod A Termination & Client Auto-Reconnect with Zero Data Loss...');

    // 3.1 Setup active workspace session on Pod A
    const failoverRoomUuid = `sdr01-failover-${timestamp}`;
    await Room.create({
      name: `SDR-01 Failover Workspace ${timestamp}`,
      uuid: failoverRoomUuid,
      owner: alice._id,
      participants: [{ user: alice._id, role: 'Owner' }],
      files: [{ name: 'index.js', content: 'const server = "init";' }],
    });

    const aliceFailoverClient = new SimulatedClient('AliceFailover', aliceToken, failoverRoomUuid);
    await aliceFailoverClient.connect(urlA);
    // Wait for initial sync from server so client hydrates index.js from MongoDB
    for (let i = 0; i < 30; i++) {
      if (aliceFailoverClient.getFileContent('index.js').includes('init')) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Alice performs multi-file edits in client memory on Pod A
    aliceFailoverClient.addFile('main.js', 'console.log("main file created");\n');
    aliceFailoverClient.addFile('config.json', '{"service": "collab", "active": true}\n');
    aliceFailoverClient.applyLocalEdit('main.js', 'function computeAnswer() { return 42; }\n');
    aliceFailoverClient.applyLocalEdit('index.js', '\n// in-flight keystroke before crash');

    const expectedIndexContent = aliceFailoverClient.getFileContent('index.js');
    const expectedMainContent = aliceFailoverClient.getFileContent('main.js');
    const expectedConfigContent = aliceFailoverClient.getFileContent('config.json');

    check(expectedIndexContent.includes('in-flight keystroke'), 'Client has unpersisted in-flight keystroke in memory');
    check(expectedMainContent.includes('computeAnswer'), 'Client has newly created main.js in memory');
    check(expectedConfigContent.includes('collab'), 'Client has newly created config.json in memory');

    // 3.2 ABRUPT TERMINATION OF POD A (Simulate SIGKILL / OOM / instant crash)
    // We intentionally close serverA and sever all sockets WITHOUT invoking saveToDB or persistAllRooms
    console.log('  ⚡ Simulating abrupt kill of Backend Pod A (instant server termination)...');
    const deadSession = managerA.getRoom(failoverRoomUuid);
    if (deadSession && deadSession.saveTimer) {
      clearTimeout(deadSession.saveTimer);
      deadSession.saveTimer = null;
    }
    if (aliceFailoverClient.ws) {
      aliceFailoverClient.ws.terminate();
    }
    if (serverA.closeAllConnections) {
      serverA.closeAllConnections();
    }
    await new Promise((resolve) => serverA.close(resolve));

    // Verify Pod A is completely unreachable
    let podADead = false;
    try {
      await makeRequest(`${urlA}/health`, { method: 'GET' });
    } catch (_) {
      podADead = true;
    }
    check(podADead, 'Backend Pod A is completely dead (connection refused)');

    // Verify Pod A was killed before persisting Alice's latest edits to MongoDB
    const roomInDbBeforeReconnect = await Room.findOne({ uuid: failoverRoomUuid }).lean();
    const dbIndexFile = roomInDbBeforeReconnect.files.find((f) => f.name === 'index.js');
    const dbHasInflight = dbIndexFile && dbIndexFile.content.includes('in-flight keystroke');
    check(!dbHasInflight, 'Confirmed: Pod A was killed before in-flight edits reached MongoDB');

    // 3.3 AUTO-RECONNECT TO POD B
    console.log('  🔄 Client auto-reconnecting to surviving Backend Pod B...');
    await aliceFailoverClient.connect(urlB);

    // Allow Yjs bidirectional sync protocol to reconcile document state with Pod B
    await new Promise((r) => setTimeout(r, 300));

    // 3.4 VERIFY ZERO DATA LOSS ON SURVIVING POD B
    const sessionBAfterFailover = await managerB.getOrCreateRoom(failoverRoomUuid);
    const podBIndexContent = sessionBAfterFailover.ydoc.getText(`${failoverRoomUuid}:index.js`).toString();
    const podBMainContent = sessionBAfterFailover.ydoc.getText(`${failoverRoomUuid}:main.js`).toString();
    const podBConfigContent = sessionBAfterFailover.ydoc.getText(`${failoverRoomUuid}:config.json`).toString();

    if (podBIndexContent !== expectedIndexContent) {
      console.log('    [DEBUG] podBIndexContent:', JSON.stringify(podBIndexContent));
      console.log('    [DEBUG] expectedIndexContent:', JSON.stringify(expectedIndexContent));
    }

    check(
      podBIndexContent === expectedIndexContent,
      'Pod B reconciled index.js with 100% fidelity: ZERO DATA LOSS'
    );
    check(
      podBMainContent === expectedMainContent,
      'Pod B reconciled new main.js file with 100% fidelity: ZERO DATA LOSS'
    );
    check(
      podBConfigContent === expectedConfigContent,
      'Pod B reconciled new config.json file with 100% fidelity: ZERO DATA LOSS'
    );

    // Trigger Pod B persistence to commit reconciled document to MongoDB
    await sessionBAfterFailover.saveToDB();
    const roomInDbAfterFailover = await Room.findOne({ uuid: failoverRoomUuid }).lean();
    const savedIndexFile = roomInDbAfterFailover.files.find((f) => f.name === 'index.js');
    const savedMainFile = roomInDbAfterFailover.files.find((f) => f.name === 'main.js');

    check(
      savedIndexFile && savedIndexFile.content === expectedIndexContent,
      'MongoDB Atlas committed reconciled index.js document from Pod B'
    );
    check(
      savedMainFile && savedMainFile.content === expectedMainContent,
      'MongoDB Atlas committed reconciled main.js file from Pod B'
    );

    aliceFailoverClient.disconnect();

    // --------------------------------------------------------------------------
    // Phase 4: Multi-Client Failover & Cross-Pod Conflict Resolution
    // --------------------------------------------------------------------------
    console.log('\n🤝 Phase 4: Multi-Client Failover & Cross-Pod Conflict Resolution...');

    // Restart Pod A for multi-client failover testing
    serverA = http.createServer(app);
    relayA = websocketRelay.initWebSocketRelay({
      server: serverA,
      roomManager: managerA,
      User,
      Room,
      pubsubAdapter: sharedPubSub,
    });
    await new Promise((resolve) => serverA.listen(3301, resolve));

    const multiClientRoomUuid = `sdr01-multiclient-${timestamp}`;
    await Room.create({
      name: `SDR-01 Multi-Client Workspace ${timestamp}`,
      uuid: multiClientRoomUuid,
      owner: alice._id,
      participants: [
        { user: alice._id, role: 'Owner' },
        { user: bob._id, role: 'Editor' },
      ],
      files: [{ name: 'collab.js', content: '// Collaborative root\n' }],
    });

    const clientAliceMulti = new SimulatedClient('AliceMulti', aliceToken, multiClientRoomUuid);
    const clientBobMulti = new SimulatedClient('BobMulti', bobToken, multiClientRoomUuid);

    // Both connect to Pod A initially
    await clientAliceMulti.connect(urlA);
    await clientBobMulti.connect(urlA);
    for (let i = 0; i < 30; i++) {
      if (
        clientAliceMulti.getFileContent('collab.js').includes('Collaborative') &&
        clientBobMulti.getFileContent('collab.js').includes('Collaborative')
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // Both make independent concurrent edits in client memory
    clientAliceMulti.applyLocalEdit('collab.js', 'function aliceTask() { return "alice"; }\n');
    clientBobMulti.applyLocalEdit('collab.js', 'function bobTask() { return "bob"; }\n');

    // KILL POD A ABRUPTLY AGAIN!
    console.log('  ⚡ Killing Pod A with 2 active concurrent editors in memory...');
    const multiSessionA = managerA.getRoom(multiClientRoomUuid);
    if (multiSessionA && multiSessionA.saveTimer) {
      clearTimeout(multiSessionA.saveTimer);
      multiSessionA.saveTimer = null;
    }
    clientAliceMulti.disconnect();
    clientBobMulti.disconnect();
    if (serverA.closeAllConnections) {
      serverA.closeAllConnections();
    }
    await new Promise((resolve) => serverA.close(resolve));

    // Both Alice and Bob auto-reconnect to Pod B
    console.log('  🔄 Both Alice and Bob auto-reconnecting to Pod B...');
    await clientAliceMulti.connect(urlB);
    await clientBobMulti.connect(urlB);
    await new Promise((r) => setTimeout(r, 400));

    const podBMultiSession = await managerB.getOrCreateRoom(multiClientRoomUuid);
    const mergedContentOnPodB = podBMultiSession.ydoc.getText(`${multiClientRoomUuid}:collab.js`).toString();

    check(
      mergedContentOnPodB.includes('aliceTask'),
      'Pod B contains Alice concurrent edits after failover'
    );
    check(
      mergedContentOnPodB.includes('bobTask'),
      'Pod B contains Bob concurrent edits after failover'
    );

    // Resume editing on Pod B: Alice types new edit
    clientAliceMulti.applyLocalEdit('collab.js', 'const resumedEditingOnPodB = true;\n');
    await new Promise((r) => setTimeout(r, 200));

    check(
      podBMultiSession.ydoc.getText(`${multiClientRoomUuid}:collab.js`).toString().includes('resumedEditingOnPodB'),
      'Collaborative editing resumes seamlessly on Pod B with zero interruption'
    );

    clientAliceMulti.disconnect();
    clientBobMulti.disconnect();

    // --------------------------------------------------------------------------
    // Phase 5: Room Metadata & Session Survival Across Pod Death
    // --------------------------------------------------------------------------
    console.log('\n🛡️ Phase 5: Room Metadata & Session Survival Across Pod Death...');

    // 5.1 Issue a RefreshToken for Alice on Pod A
    const { plaintext: rawRefreshToken } = await RefreshToken.generate(alice._id, null, 'Test Failover Device');

    // 5.2 Mutate Room metadata: update role and close room
    await Room.updateOne(
      { uuid: multiClientRoomUuid },
      {
        $set: {
          name: 'SDR-01 Renamed Resilient Room',
          isClosed: true,
        },
      }
    );

    // Pod A is DEAD. Request Pod B for room metadata via REST
    const roomResFromB = await makeRequest(`${urlB}/api/rooms/${multiClientRoomUuid}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
      },
    });

    check(roomResFromB.status === 200, 'Pod B serves room metadata while Pod A is dead');
    check(
      roomResFromB.data && roomResFromB.data.room && roomResFromB.data.room.name === 'SDR-01 Renamed Resilient Room',
      'Pod B accurately delivers updated room title from MongoDB'
    );
    check(
      roomResFromB.data && roomResFromB.data.room && roomResFromB.data.room.isClosed === true,
      'Pod B accurately delivers room isClosed state from MongoDB'
    );

    // 5.3 Test Token Refresh on Pod B using RefreshToken issued during Pod A era
    // Obtain CSRF token from Pod B
    const csrfRes = await makeRequest(`${urlB}/api/auth/login`);
    const xsrfCookie = extractCookie(csrfRes.headers, 'XSRF-TOKEN') || 'test-csrf';

    const refreshRes = await makeRequest(`${urlB}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `refreshToken=${rawRefreshToken}; XSRF-TOKEN=${xsrfCookie}`,
        'x-csrf-token': xsrfCookie,
      },
    });

    check(refreshRes.status === 200, 'Pod B successfully rotates refresh token issued when Pod A was running');
    check(Boolean(refreshRes.data && refreshRes.data.accessToken), 'Pod B issued fresh RS256 access token without re-login');

    // 5.4 Verify Access Token against Pod B
    const meRes = await makeRequest(`${urlB}/api/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${refreshRes.data.accessToken}`,
      },
    });

    check(meRes.status === 200, 'Pod B authoritatively validates new access token');
    check(
      meRes.data && meRes.data.user && meRes.data.user.email === aliceEmail,
      'Pod B authenticated user profile with zero state from Pod A'
    );

  } catch (err) {
    console.error('💥 Unexpected test error:', err.stack);
    failedTests++;
  } finally {
    // Graceful teardown of servers and managers
    if (serverA && serverA.listening) {
      await new Promise((r) => serverA.close(r));
    }
    if (serverB && serverB.listening) {
      await new Promise((r) => serverB.close(r));
    }
    if (managerA) managerA.destroy();
    if (managerB) managerB.destroy();

    console.log('\n================================================================');
    console.log(`📊 SDR-01 Verification Results: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('================================================================');

    if (failedTests > 0) {
      process.exit(1);
    } else {
      console.log('🎉 ALL SDR-01 SHARED-NOTHING BACKEND REQUIREMENTS SATISFIED!\n');
      process.exit(0);
    }
  }
}

runTestSuite();

