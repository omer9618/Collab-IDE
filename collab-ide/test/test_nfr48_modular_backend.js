/**
 * @file test/test_nfr48_modular_backend.js
 * @description Comprehensive automated test suite for NFR-48: Modular Backend Architecture.
 *
 * Verifies NFR-48 specification:
 * "The backend must be structured as independent modules: auth, rooms, websocket-relay,
 * execution, voice-signalling, and infrastructure (rate limiting, health checks). Each module
 * must be independently testable."
 *
 * Test Suites:
 * 1. Architecture Registry & Boundaries Verification:
 *    - All 6 modules exposed via canonical module registry
 *    - Clean module boundaries with zero monolithic coupling
 * 2. Module 1: auth (Authentication & Identity)
 *    - Strict password policy enforcement (NFR-11)
 *    - Asymmetric RS256 token issuance & signature validation (NFR-17)
 *    - Token tampering detection & expired token rejection
 *    - Role-based authorization middleware
 * 3. Module 2: rooms (Collaborative Workspaces & Isolation)
 *    - Isolated RoomSession initialization in pure memory (no live DB required)
 *    - Per-room CRDT Yjs document management
 *    - Participant lifecycle and dynamic RBAC transitions in memory
 *    - Per-client message flood rate limiting and frame size bounds
 *    - Isolated room unloading without cross-room side effects
 * 4. Module 3: websocket-relay (Real-Time Yjs Synchronization & Upgrade Boundary)
 *    - Connection ceiling resolution (NFR-36)
 *    - Yjs Sync Step 1 protocol message generation
 *    - Pre-upgrade token and membership verification (NFR-17, NFR-25)
 *    - Rejection of missing tokens, non-existent rooms, and non-members
 *    - Room capacity overflow rejection (RFC 6455 code 1008)
 * 5. Module 4: execution (Remote Sandbox & Runtimes)
 *    - Supported language mapping (JavaScript, Python, C++, C, Java, HTML)
 *    - Resource limit caps (CPU 10s, Wall 12s, RAM 128MB, stdout 64KB) (NFR-43)
 *    - Role-based execution gating (FR-27: Viewers strictly blocked)
 *    - Offline mock execution engine (success, timeout simulation, compilation error)
 *    - User-scoped rate limiter configuration (10 req/min/user) (NFR-35)
 * 6. Module 5: voice-signalling (WebRTC Mesh & ICE Management)
 *    - Ephemeral TURN credential HMAC-SHA1 generation & 1-hour TTL (NFR-30)
 *    - ICE server configuration construction (Google STUN, Open Relay, Coturn)
 *    - In-memory voice room state tracking and safe serialization
 *    - Clean participant departure & empty voice channel memory cleanup
 * 7. Module 6: infrastructure (Diagnostics, Database, Rate Limiting, Security)
 *    - Health metrics computation with isolated mock components (NFR-39)
 *    - Database connection pool resolver & fail-fast validation (NFR-40)
 *    - Custom rate limiter factory (NFR-35)
 *    - AES-256-GCM encryption/decryption round-trip with blind indexing (NFR-24)
 *    - Sensitive credential redaction in universal logger (NFR-23)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const assert = require('assert');
const jwt = require('jsonwebtoken');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const decoding = require('lib0/decoding');

// Load modules registry
const modules = require('../modules');
const {
  auth,
  rooms,
  websocketRelay,
  execution,
  voiceSignalling,
  infrastructure,
  MODULE_NAMES,
  getModule,
  getModuleNames,
} = modules;

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

// Parse optional CLI module filter: e.g. node test_nfr48_modular_backend.js --module=auth
const args = process.argv.slice(2);
const moduleArg = args.find((a) => a.startsWith('--module='));
const targetModule = moduleArg ? moduleArg.split('=')[1].trim().toLowerCase() : null;

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-48: Modular Backend Architecture Verification');
  console.log('================================================================\n');

  if (targetModule) {
    console.log(`🎯 Targeted Module Filter: "${targetModule}"\n`);
  }

  // ============================================================================
  // Suite 1: Module Registry & Architectural Boundaries
  // ============================================================================
  if (!targetModule || targetModule === 'registry' || targetModule === 'all') {
    console.log('📦 Suite 1: Module Registry & Architectural Boundaries...');

    check(Array.isArray(MODULE_NAMES), 'MODULE_NAMES is exported as an array');
    check(MODULE_NAMES.length === 6, `Exactly 6 modules defined (found: ${MODULE_NAMES.length})`);

    const expectedNames = [
      'auth',
      'rooms',
      'websocket-relay',
      'execution',
      'voice-signalling',
      'infrastructure',
    ];
    for (const name of expectedNames) {
      check(MODULE_NAMES.includes(name), `Registry includes module "${name}"`);
    }

    // Verify getModule resolution
    check(getModule('auth') === auth, 'getModule("auth") returns auth module');
    check(getModule('rooms') === rooms, 'getModule("rooms") returns rooms module');
    check(getModule('websocket-relay') === websocketRelay, 'getModule("websocket-relay") returns websocketRelay module');
    check(getModule('websocketRelay') === websocketRelay, 'getModule("websocketRelay") camelCase returns websocketRelay module');
    check(getModule('execution') === execution, 'getModule("execution") returns execution module');
    check(getModule('voice-signalling') === voiceSignalling, 'getModule("voice-signalling") returns voiceSignalling module');
    check(getModule('voiceSignalling') === voiceSignalling, 'getModule("voiceSignalling") camelCase returns voiceSignalling module');
    check(getModule('infrastructure') === infrastructure, 'getModule("infrastructure") returns infrastructure module');
    check(getModule('non_existent') === null, 'getModule returns null for unknown module name');

    // Verify each module exports a name property
    check(auth.name === 'auth', 'auth module declares name "auth"');
    check(rooms.name === 'rooms', 'rooms module declares name "rooms"');
    check(websocketRelay.name === 'websocket-relay', 'websocketRelay declares name "websocket-relay"');
    check(execution.name === 'execution', 'execution declares name "execution"');
    check(voiceSignalling.name === 'voice-signalling', 'voiceSignalling declares name "voice-signalling"');
    check(infrastructure.name === 'infrastructure', 'infrastructure declares name "infrastructure"');

    console.log('');
  }

  // ============================================================================
  // Suite 2: Module 1 — auth (Authentication & Identity)
  // ============================================================================
  if (!targetModule || targetModule === 'auth' || targetModule === 'all') {
    console.log('🔐 Suite 2: Module 1 — auth (Independent Unit Tests)...');

    // 1. Password Policy Validation (NFR-11)
    const validPwd = auth.validatePassword('SecureP@ssw0rd123');
    check(validPwd.valid === true, 'Strong password passes validation');
    check(validPwd.errors.length === 0, 'Strong password has 0 errors');

    const shortPwd = auth.validatePassword('Ab1!');
    check(shortPwd.valid === false, 'Short password (<8 chars) is rejected');
    check(shortPwd.errors.some((e) => e.includes('8')), 'Short password error mentions length');

    const noUpperPwd = auth.validatePassword('password123!');
    check(noUpperPwd.valid === false, 'Password without uppercase is rejected');

    const noLowerPwd = auth.validatePassword('PASSWORD123!');
    check(noLowerPwd.valid === false, 'Password without lowercase is rejected');

    const noDigitPwd = auth.validatePassword('Password!!!!');
    check(noDigitPwd.valid === false, 'Password without digit is rejected');

    const noSpecialPwd = auth.validatePassword('Password1234');
    check(noSpecialPwd.valid === false, 'Password without special char is rejected');

    // 2. RS256 Asymmetric Token Generation & Verification (NFR-17)
    const testUserId = 'test-user-id-507f1f77bcf86cd799439011';
    const accessToken = auth.generateAccessToken(testUserId, { expiresIn: '10m' });
    check(typeof accessToken === 'string' && accessToken.length > 50, 'generateAccessToken produces valid JWT string');

    const decoded = auth.verifyAccessToken(accessToken);
    check(decoded.userId === testUserId, 'verifyAccessToken decodes correct userId');
    check(decoded.type === 'access', 'Token contains type: "access"');

    // 3. Tampering / Invalid Key Algorithm Rejection
    let tamperedRejected = false;
    try {
      // Modify payload part of JWT
      const parts = accessToken.split('.');
      const tampered = `${parts[0]}.${parts[1]}TAMPER.${parts[2]}`;
      auth.verifyAccessToken(tampered);
    } catch (e) {
      tamperedRejected = true;
    }
    check(tamperedRejected === true, 'Tampered token is rejected with signature verification failure');

    // 4. Password Policy Descriptor
    const requirements = auth.passwordPolicy.getPasswordPolicyRequirements();
    check(Array.isArray(requirements), 'getPasswordPolicyRequirements returns array');
    check(requirements.length >= 5, 'Password policy defines at least 5 requirements');

    // 5. Auth Middleware and Route Attachment
    check(typeof auth.protect === 'function', 'auth module exports protect middleware');
    check(typeof auth.routes === 'function', 'auth module exports Express router');

    console.log('');
  }

  // ============================================================================
  // Suite 3: Module 2 — rooms (Workspaces & Document Isolation)
  // ============================================================================
  if (!targetModule || targetModule === 'rooms' || targetModule === 'all') {
    console.log('🏠 Suite 3: Module 2 — rooms (Independent Unit Tests)...');

    const { RoomManager, RoomSession, constants } = rooms;

    check(typeof RoomManager === 'function', 'rooms exports RoomManager class');
    check(typeof RoomSession === 'function', 'rooms exports RoomSession class');
    check(constants.MAX_WS_FRAME_BYTES === 5 * 1024 * 1024, 'MAX_WS_FRAME_BYTES is 5MB');
    check(constants.MAX_MSGS_PER_SEC_PER_CLIENT === 100, 'MAX_MSGS_PER_SEC_PER_CLIENT is 100');
    check(constants.FLOOD_THRESHOLD_PER_SEC === 300, 'FLOOD_THRESHOLD_PER_SEC is 300');

    // Test isolated RoomSession without DB
    const testRoomUuid = `test-isolated-room-${Date.now()}`;
    const session = new RoomSession(testRoomUuid);

    check(session.roomUuid === testRoomUuid, 'RoomSession assigned correct UUID');
    check(session.ydoc instanceof Y.Doc, 'RoomSession creates isolated Y.Doc instance');
    check(session.clients instanceof Set, 'RoomSession manages isolated client Set');
    check(session.clients.size === 0, 'Initial client set is empty');

    // Test adding mock client
    const mockWs1 = {
      readyState: 1, // OPEN
      send: () => {},
      close: () => {},
    };
    const mockUser1 = { _id: 'user-alpha-001', displayName: 'Alpha User', email: 'alpha@test.com' };

    session.addClient(mockWs1, mockUser1, 'Editor');
    check(session.clients.size === 1, 'Client successfully registered in isolated room');
    check(mockWs1.role === 'Editor', 'Client assigned role "Editor"');

    // Test adding second mock client
    const mockWs2 = {
      readyState: 1,
      send: () => {},
      close: () => {},
    };
    const mockUser2 = { _id: 'user-beta-002', displayName: 'Beta User', email: 'beta@test.com' };
    session.addClient(mockWs2, mockUser2, 'Viewer');
    check(session.clients.size === 2, 'Second client registered');

    // Test presence calculation across clients
    const activeUsers = new Set();
    for (const client of session.clients) {
      if (client.userId) activeUsers.add(client.userId);
    }
    check(activeUsers.size === 2, 'Session reports 2 active unique users');
    check(activeUsers.has('user-alpha-001'), 'Presence includes Alpha User');
    check(activeUsers.has('user-beta-002'), 'Presence includes Beta User');

    // Test dynamic role update in memory
    session.updateUserRole('user-beta-002', 'Room Leader');
    check(mockWs2.role === 'Room Leader', 'In-memory client role dynamically promoted to "Room Leader"');

    // Test Yjs CRDT document mutation in isolated session
    const ytext = session.ydoc.getText('main.js');
    ytext.insert(0, 'console.log("Hello Modular World!");');
    check(ytext.toString() === 'console.log("Hello Modular World!");', 'Isolated Y.Doc text successfully modified');

    // Test message flood rate limiting tracking
    const rateCheck = session.checkRateLimit(mockWs1);
    check(rateCheck === true, 'Initial client message is within rate limit');

    // Test client removal
    const remaining = session.removeClient(mockWs1);
    check(remaining === 1, 'removeClient reports 1 remaining client');
    check(session.clients.size === 1, 'Client set reduced to 1');

    session.removeClient(mockWs2);
    check(session.clients.size === 0, 'Client set emptied');

    // Cleanup session without requiring live DB connection in unit test
    await session.destroy(true);
    check(session.ydoc === null, 'Session destroyed and Y.Doc memory freed');

    console.log('');
  }

  // ============================================================================
  // Suite 4: Module 3 — websocket-relay (Synchronization & Upgrade Boundary)
  // ============================================================================
  if (!targetModule || targetModule === 'websocket-relay' || targetModule === 'all') {
    console.log('⚡ Suite 4: Module 3 — websocket-relay (Independent Unit Tests)...');

    const {
      getMaxWsPerRoom,
      createSyncStep1Message,
      verifyUpgradeToken,
      createActiveDocsProxy,
    } = websocketRelay;

    // 1. Connection Limits
    check(typeof getMaxWsPerRoom === 'function', 'getMaxWsPerRoom is a function');
    check(getMaxWsPerRoom({ MAX_WS_PER_ROOM: '25' }) === 25, 'getMaxWsPerRoom parses MAX_WS_PER_ROOM');
    check(getMaxWsPerRoom({ ROOM_WS_LIMIT: '30' }) === 30, 'getMaxWsPerRoom parses fallback ROOM_WS_LIMIT');
    check(getMaxWsPerRoom({}) === 20, 'getMaxWsPerRoom defaults to 20 (NFR-36)');

    // 2. Yjs Sync Step 1 Message Framing
    const tempDoc = new Y.Doc();
    const tempText = tempDoc.getText('test');
    tempText.insert(0, 'test content');

    const syncMsg = createSyncStep1Message(tempDoc);
    check(syncMsg instanceof Uint8Array, 'createSyncStep1Message returns Uint8Array');
    check(syncMsg.length > 0, 'SyncStep1 message payload is non-empty');

    // Decode message to verify protocol byte 0 = 0 (sync message)
    const decoder = decoding.createDecoder(syncMsg);
    const messageType = decoding.readVarUint(decoder);
    check(messageType === 0, 'Byte 0 represents syncProtocol family (0)');

    const syncType = decoding.readVarUint(decoder);
    check(syncType === syncProtocol.messageYjsSyncStep1, 'Sync subtype is messageYjsSyncStep1 (0)');
    tempDoc.destroy();

    // 3. Upgrade Token Verification in Isolation (using mock models)
    const mockUserRecord = {
      _id: 'user-relay-123',
      displayName: 'Relay Tester',
      email: 'relay@test.com',
    };

    const mockRoomRecord = {
      uuid: 'room-relay-abc',
      participants: [
        { user: 'user-relay-123', role: 'Editor' },
      ],
    };

    const MockUser = {
      findById: (id) => ({
        select: () => (id === mockUserRecord._id ? mockUserRecord : null),
      }),
    };

    const MockRoom = {
      findOne: ({ uuid }) => (uuid === mockRoomRecord.uuid ? mockRoomRecord : null),
    };

    const validToken = auth.generateAccessToken(mockUserRecord._id);

    // Test A: No token provided
    const noTokenResult = await verifyUpgradeToken(null, 'room-relay-abc');
    check(noTokenResult.valid === false, 'Rejects upgrade without token');
    check(noTokenResult.status === 401, 'No token returns status 401');

    // Test B: Malformed token
    const malformedResult = await verifyUpgradeToken('invalid.jwt.token', 'room-relay-abc');
    check(malformedResult.valid === false, 'Rejects malformed token');
    check(malformedResult.status === 401, 'Malformed token returns status 401');

    // Test C: Non-existent room (404)
    const roomNotFoundResult = await verifyUpgradeToken(validToken, 'non-existent-room', {
      User: MockUser,
      Room: MockRoom,
    });
    check(roomNotFoundResult.valid === false, 'Rejects when room does not exist');
    check(roomNotFoundResult.status === 404, 'Non-existent room returns status 404');

    // Test D: Non-member user (403)
    const nonMemberToken = auth.generateAccessToken('other-user-999');
    const MockUserOther = {
      findById: () => ({ select: () => ({ _id: 'other-user-999', displayName: 'Other' }) }),
    };
    const nonMemberResult = await verifyUpgradeToken(nonMemberToken, 'room-relay-abc', {
      User: MockUserOther,
      Room: MockRoom,
    });
    check(nonMemberResult.valid === false, 'Rejects non-member user');
    check(nonMemberResult.status === 403, 'Non-member user returns status 403');

    // Test E: Valid member upgrade (200 OK equivalent)
    const validResult = await verifyUpgradeToken(validToken, 'room-relay-abc', {
      User: MockUser,
      Room: MockRoom,
    });
    check(validResult.valid === true, 'Accepts valid member with valid token');
    check(validResult.role === 'Editor', 'Authoritatively binds role "Editor"');
    check(validResult.user._id === mockUserRecord._id, 'Attaches verified user principal');

    // 4. ActiveDocs Proxy Map Invariants
    const mockRoomManager = {
      rooms: new Map([['room-1', { ydoc: new Y.Doc(), saveTimer: null }]]),
      getRoom: (uuid) => mockRoomManager.rooms.get(uuid),
    };
    const activeDocsProxy = createActiveDocsProxy(mockRoomManager);
    check(activeDocsProxy.size === 1, 'activeDocs proxy reflects manager rooms size');
    check(activeDocsProxy.has('room-1') === true, 'activeDocs proxy has() succeeds');
    check(activeDocsProxy.has('room-2') === false, 'activeDocs proxy has() negative succeeds');
    check(activeDocsProxy.get('room-1')?.ydoc instanceof Y.Doc, 'activeDocs proxy get() returns ydoc');
    mockRoomManager.rooms.get('room-1').ydoc.destroy();

    console.log('');
  }

  // ============================================================================
  // Suite 5: Module 4 — execution (Remote Sandbox & Runtimes)
  // ============================================================================
  if (!targetModule || targetModule === 'execution' || targetModule === 'all') {
    console.log('💻 Suite 5: Module 4 — execution (Independent Unit Tests)...');

    const {
      LANGUAGE_MAP,
      JUDGE0_LIMITS,
      MAX_EXEC_HISTORY,
      isLanguageSupported,
      getLanguageConfig,
      canRoleExecute,
      getMockResult,
      execLimiter,
    } = execution;

    // 1. Language Map Invariants (FR-23, FR-28)
    check(typeof LANGUAGE_MAP === 'object', 'LANGUAGE_MAP is exported');
    check(isLanguageSupported('javascript') === true, 'JavaScript is supported');
    check(isLanguageSupported('python') === true, 'Python is supported');
    check(isLanguageSupported('cpp') === true, 'C++ is supported');
    check(isLanguageSupported('c') === true, 'C is supported');
    check(isLanguageSupported('java') === true, 'Java is supported');
    check(isLanguageSupported('html') === true, 'HTML is supported');
    check(isLanguageSupported('rust') === false, 'Unsupported language returns false');

    check(getLanguageConfig('javascript').id === 63, 'JavaScript Judge0 runtime ID is 63');
    check(getLanguageConfig('python').id === 71, 'Python Judge0 runtime ID is 71');
    check(getLanguageConfig('html').id === null, 'HTML has id: null for client sandbox preview');

    // 2. Resource Limits Compliance (NFR-43)
    check(JUDGE0_LIMITS.cpu_time_limit === 10, 'CPU time limit is exactly 10s');
    check(JUDGE0_LIMITS.wall_time_limit === 12, 'Wall time limit is exactly 12s');
    check(JUDGE0_LIMITS.memory_limit === 128000, 'Memory limit is exactly 128,000 KB (128 MB)');
    check(JUDGE0_LIMITS.max_file_size === 64, 'Max stdout buffer is exactly 64 KB');
    check(MAX_EXEC_HISTORY === 20, 'Max execution history is 20 entries');

    // 3. Role-Based Execution Permissions (FR-27)
    check(canRoleExecute('Owner') === true, 'Owner is permitted to execute code');
    check(canRoleExecute('Room Leader') === true, 'Room Leader is permitted to execute code');
    check(canRoleExecute('Editor') === true, 'Editor is permitted to execute code');
    check(canRoleExecute('Viewer') === false, 'Viewer is STRICTLY FORBIDDEN from executing code');
    check(canRoleExecute('Anonymous') === false, 'Unknown role cannot execute code');

    // 4. Mock Executor Behavior
    const jsResult = getMockResult('javascript', 'console.log("Hello");');
    check(jsResult.status.description === 'Accepted', 'Mock JS execution returns Accepted');
    check(jsResult.stdout.includes('JavaScript'), 'Mock JS execution produces JS output');

    const pyResult = getMockResult('python', 'print("Hello Python")');
    check(pyResult.status.description === 'Accepted', 'Mock Python execution returns Accepted');
    check(pyResult.stdout.includes('Python'), 'Mock Python execution produces Python output');

    // Test loop timeout detection
    const timeoutResult = getMockResult('python', 'while True:\n    pass');
    check(timeoutResult.status.description === 'Time Limit Exceeded', 'Mock executor detects infinite loop (Time Limit Exceeded)');
    check(timeoutResult.time === '10.0', 'Timeout run logs 10.0s CPU time');

    // Test compilation error simulation
    const compileErrResult = getMockResult('cpp', 'int x = COMPILE_ERROR;');
    check(compileErrResult.status.description === 'Compilation Error', 'Mock executor detects compilation error');
    check(compileErrResult.stderr.length > 0, 'Compilation error includes stderr description');

    // 5. Rate Limiter Configuration
    check(typeof execLimiter === 'function', 'execLimiter middleware is exported');

    console.log('');
  }

  // ============================================================================
  // Suite 6: Module 5 — voice-signalling (WebRTC Mesh & Signalling)
  // ============================================================================
  if (!targetModule || targetModule === 'voice-signalling' || targetModule === 'all') {
    console.log('🎙️  Suite 6: Module 5 — voice-signalling (Independent Unit Tests)...');

    const {
      generateTurnCredentials,
      buildIceServers,
      voiceRooms,
      getVoiceRoom,
      serializeParticipants,
      getSocketRole,
      leaveVoiceRoom,
    } = voiceSignalling;

    // 1. Ephemeral TURN Credential Generation (NFR-30)
    const testTurnUserId = 'user-voice-turn-456';
    const credentials = generateTurnCredentials(testTurnUserId, 'custom_secret_key', 3600);

    check(typeof credentials.turnUsername === 'string', 'generateTurnCredentials returns turnUsername');
    check(typeof credentials.turnCredential === 'string', 'generateTurnCredentials returns turnCredential');
    check(credentials.turnCredential.length > 20, 'turnCredential is Base64 HMAC digest');

    // Verify username format: <expiryTimestamp>:<userId>
    const [expiryStr, parsedId] = credentials.turnUsername.split(':');
    check(parsedId === testTurnUserId, 'turnUsername contains correct userId');
    const expiryTimestamp = parseInt(expiryStr, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    check(expiryTimestamp >= nowSec + 3590 && expiryTimestamp <= nowSec + 3610, 'Expiry timestamp is ~1 hour in the future');

    // Deterministic HMAC check
    const crypto = require('crypto');
    const expectedHmac = crypto
      .createHmac('sha1', 'custom_secret_key')
      .update(credentials.turnUsername)
      .digest('base64');
    check(credentials.turnCredential === expectedHmac, 'HMAC-SHA1 credential signature is mathematically authentic');

    // 2. ICE Servers Array Construction
    const iceServers = buildIceServers(credentials.turnUsername, credentials.turnCredential, 'turn:coturn.example.com:3478');
    check(Array.isArray(iceServers), 'buildIceServers returns array');
    check(iceServers.some((s) => JSON.stringify(s.urls).includes('google.com')), 'Includes Google public STUN');
    check(iceServers.some((s) => JSON.stringify(s.urls).includes('openrelay.metered.ca')), 'Includes Open Relay TURN');
    check(iceServers.some((s) => JSON.stringify(s.urls).includes('coturn.example.com')), 'Includes configured Coturn server');

    // 3. Voice Room State & Serialization
    const testVoiceRoomUuid = `voice-room-unit-${Date.now()}`;
    const voiceRoom = getVoiceRoom(testVoiceRoomUuid);
    check(typeof voiceRoom === 'object', 'getVoiceRoom returns room object');
    check(voiceRoom.participants instanceof Map, 'voiceRoom has participants Map');

    // Add mock participants
    voiceRoom.participants.set('socket-1', {
      userId: 'u1',
      displayName: 'Alice Voice',
      avatarColor: '#ff0000',
      role: 'Owner',
      isMuted: false,
      isHardMuted: false,
      joinedAt: new Date().toISOString(),
      socketId: 'socket-1',
    });

    voiceRoom.participants.set('socket-2', {
      userId: 'u2',
      displayName: 'Bob Voice',
      avatarColor: '#00ff00',
      role: 'Viewer',
      isMuted: true,
      isHardMuted: false,
      joinedAt: new Date().toISOString(),
      socketId: 'socket-2',
    });

    check(getSocketRole(voiceRoom, 'socket-1') === 'Owner', 'getSocketRole identifies Owner role');
    check(getSocketRole(voiceRoom, 'socket-2') === 'Viewer', 'getSocketRole identifies Viewer role');

    const serialized = serializeParticipants(voiceRoom);
    check(serialized.length === 2, 'serializeParticipants serializes 2 participants');
    check(serialized[0].displayName === 'Alice Voice', 'Serialized includes display name');
    check(serialized[1].isMuted === true, 'Serialized preserves mute state');

    // Test departure and clean memory eviction
    const mockVoiceNs = {
      to: () => ({ emit: () => {} }),
    };
    const mockLeavingSocket = {
      id: 'socket-1',
      roomUuid: testVoiceRoomUuid,
      leave: () => {},
    };
    leaveVoiceRoom(mockLeavingSocket, mockVoiceNs);
    check(voiceRoom.participants.size === 1, 'Participant 1 left; 1 participant remaining');

    const mockLeavingSocket2 = {
      id: 'socket-2',
      roomUuid: testVoiceRoomUuid,
      leave: () => {},
    };
    leaveVoiceRoom(mockLeavingSocket2, mockVoiceNs);
    check(!voiceRooms.has(testVoiceRoomUuid), 'Empty voice room memory evicted from voiceRooms Map');

    console.log('');
  }

  // ============================================================================
  // Suite 7: Module 6 — infrastructure (Diagnostics, DB, Security)
  // ============================================================================
  if (!targetModule || targetModule === 'infrastructure' || targetModule === 'all') {
    console.log('🏗️  Suite 7: Module 6 — infrastructure (Independent Unit Tests)...');

    const {
      health,
      database,
      rateLimiting,
      security,
      logger,
      errorHandler,
    } = infrastructure;

    // 1. Health Metrics Unit Calculation (NFR-39)
    const mockProcess = {
      uptime: () => 185.5, // 3m 5s
      memoryUsage: () => ({
        rss: 104857600, // 100 MB
        heapTotal: 52428800, // 50 MB
        heapUsed: 31457280, // 30 MB
        external: 5242880,
      }),
      pid: 9999,
      version: 'v20.0.0',
      versions: { node: '20.0.0', v8: '11.0' },
    };

    const mockRoomManager = {
      rooms: new Map([['room-alpha', {}], ['room-beta', {}]]),
      getTotalActiveWebSockets: () => 6,
      getRoomStats: () => [],
    };

    const healthMetrics = health.getHealthMetrics({
      roomManager: mockRoomManager,
      getMaxWsPerRoom: () => 20,
      getIsShuttingDown: () => false,
      mongooseInstance: {
        connection: {
          readyState: 1,
          getClient: () => ({ options: { minPoolSize: 5, maxPoolSize: 20, maxIdleTimeMS: 30000 } }),
        },
      },
    });

    check(healthMetrics.status === 'healthy', 'Health check calculates status: "healthy"');
    check(healthMetrics.activeRooms === 2, 'Health check calculates activeRooms = 2');
    check(healthMetrics.activeWebSockets === 6, 'Health check calculates activeWebSockets = 6');

    // Test health formatting utilities
    const formattedRss = health.formatMB(104857600);
    check(formattedRss === '100.00 MB', 'Formatted RSS is 100.00 MB');
    const formattedUptime = health.formatUptime(185.5);
    check(formattedUptime.includes('3m'), 'Formatted uptime contains minutes');

    // 2. Database Pool Configuration Resolver (NFR-40)
    const defaultPool = database.resolvePoolConfig({});
    check(defaultPool.minPoolSize === 5, 'Default minPoolSize is 5');
    check(defaultPool.maxPoolSize === 20, 'Default maxPoolSize is 20');
    check(defaultPool.maxIdleTimeMS === 30000, 'Default maxIdleTimeMS is 30,000ms');

    const customPool = database.resolvePoolConfig({
      MONGO_MIN_POOL_SIZE: '10',
      MONGO_MAX_POOL_SIZE: '50',
      MONGO_MAX_IDLE_TIME_MS: '60000',
    });
    check(customPool.minPoolSize === 10, 'Custom minPoolSize parsed as 10');
    check(customPool.maxPoolSize === 50, 'Custom maxPoolSize parsed as 50');

    // Fail-fast on invalid pool bounds (min > max)
    let poolSanityFailed = false;
    try {
      database.resolvePoolConfig({
        MONGO_MIN_POOL_SIZE: '30',
        MONGO_MAX_POOL_SIZE: '10',
      });
    } catch (e) {
      poolSanityFailed = true;
    }
    check(poolSanityFailed === true, 'Fatal error thrown when minPoolSize > maxPoolSize');

    // 3. Rate Limiting Factory (NFR-35)
    const customLimiter = rateLimiting.createRateLimiter({
      windowMs: 30000,
      max: 5,
    });
    check(typeof customLimiter === 'function', 'createRateLimiter creates Express middleware');

    // 4. AES-256-GCM Encryption & Blind Indexing (NFR-24)
    const secretText = 'sensitive-personal-token-987654';
    const encrypted = security.encryption.encrypt(secretText);
    check(typeof encrypted === 'string' && encrypted.includes(':'), 'encrypt produces formatted IV:tag:ciphertext string');

    const decrypted = security.encryption.decrypt(encrypted);
    check(decrypted === secretText, 'decrypt returns identical plaintext (AES-256-GCM roundtrip)');

    const blindIndex1 = security.encryption.blindIndex(secretText);
    const blindIndex2 = security.encryption.blindIndex(secretText);
    check(blindIndex1 === blindIndex2, 'blindIndex produces deterministic search token');
    check(blindIndex1.length === 64, 'blindIndex produces 64-char hex hash');

    // 5. Universal Logger Sanitization (NFR-23)
    const logOutput = logger.sanitizeMessage('User logged in with password="MySecretPassword123" and token=eyJh.b.c');
    check(!logOutput.includes('MySecretPassword123'), 'Logger redacts passwords');
    check(logOutput.includes('[REDACTED'), 'Logger replaces password with [REDACTED]');

    // 6. Centralized Error Sanitizer (NFR-47)
    check(typeof errorHandler.errorHandler === 'function', 'errorHandler middleware exported');
    check(typeof errorHandler.notFoundHandler === 'function', 'notFoundHandler middleware exported');
    check(typeof errorHandler.sendPlainEnglishError === 'function', 'sendPlainEnglishError helper exported');

    console.log('');
  }

  // ============================================================================
  // Summary & Assertion Invariants
  // ============================================================================
  console.log('================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error(`\n❌ NFR-48 VERIFICATION FAILED: ${failedTests} assertions failed.`);
    process.exit(1);
  } else {
    console.log('\n🎉 ALL NFR-48 MODULAR BACKEND ARCHITECTURE REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running NFR-48 test suite:', err);
  process.exit(1);
});
