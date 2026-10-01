/**
 * ==============================================================================
 * CollabIDE - NFR-13: Refresh Token Rotation & Reuse Detection Test Suite
 * ==============================================================================
 * 
 * Verifies NFR-13 requirements:
 * 1. Refresh Token Rotation (RTR): Every refresh issues a new cryptographically
 *    random refresh token and marks the previous token as rotated (isRotated: true).
 * 2. Session Family Preservation: Successive rotations maintain the same familyId.
 * 3. Reuse / Replay Detection: Presentation of an already-rotated token detects theft
 *    or replay, returns HTTP 403 Forbidden, clears auth cookies, and completely
 *    invalidates the entire session family in MongoDB.
 * 4. Victim & Attacker Lockout: Sibling tokens in the invalidated family are
 *    instantly revoked, forcing full re-authentication for all parties.
 * 5. Concurrency Protection: Race conditions from simultaneous refresh attempts
 *    with the same token are atomically mitigated (findOneAndUpdate), triggering
 *    reuse detection and immediate family invalidation.
 * 6. Session Management Integration (FR-07): Active session listing filters out
 *    rotated tokens, accurately identifies isCurrent via family matching, and
 *    remote revocation purges the entire session family.
 * 7. Expired Token Purge: Expired tokens are rejected with HTTP 401 and purged.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { app } = require('../server');

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

// Helper to parse cookies from Set-Cookie headers
function parseSetCookies(res) {
  const headers = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const rawHeader = res.headers.get('set-cookie');
  const allHeaders = headers.length > 0 ? headers : (rawHeader ? rawHeader.split(/,(?=\s*[^;]+=[^;]+)/) : []);
  
  const cookies = {};
  allHeaders.forEach((str) => {
    const parts = str.split(';').map((p) => p.trim());
    const [nameVal, ...attrs] = parts;
    const [name, val] = nameVal.split('=');
    if (name) {
      cookies[name.trim()] = {
        value: val ? decodeURIComponent(val.trim()) : '',
        raw: str,
        isHttpOnly: attrs.some((a) => a.toLowerCase() === 'httponly'),
        isSameSiteStrict: attrs.some((a) => a.toLowerCase() === 'samesite=strict'),
        path: (attrs.find((a) => a.toLowerCase().startsWith('path=')) || '').split('=')[1] || '',
      };
    }
  });
  return cookies;
}

async function runTests() {
  console.log('\n================================================================');
  console.log('🧪 Starting NFR-13: Refresh Token Rotation & Reuse Detection Tests');
  console.log('================================================================\n');

  // 1. Connect to MongoDB Atlas
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI is not set in collab-ide/.env');
    process.exit(1);
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, { maxPoolSize: 5 });
  }
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => mongoose.connection.once('open', resolve));
  }
  assert(mongoose.connection.readyState === 1, 'Connected to MongoDB Atlas');

  // 2. Start Test Server on dedicated port
  const testPort = 3196;
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(testPort, resolve));
  const baseUrl = `http://localhost:${testPort}`;
  console.log(`📡 Test server listening on ${baseUrl}\n`);

  // 3. Create test user
  const testEmail = `nfr13-tester-${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testUser = await User.create({
    email: testEmail,
    password: testPassword,
    displayName: 'NFR13 Tester',
    avatarColor: '#007acc',
    isVerified: true,
  });

  try {
    // --------------------------------------------------------------------------
    // Phase 1: Login & Initial Session State
    // --------------------------------------------------------------------------
    console.log('🔑 Phase 1: User Login and Initial Session Family Creation...');
    
    // First obtain a CSRF token for the login request
    const csrfInitRes = await fetch(`${baseUrl}/api/auth/csrf-token`);
    const csrfInitData = await csrfInitRes.json();
    const csrfToken1 = csrfInitData.csrfToken;
    const initCookies = parseSetCookies(csrfInitRes);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken1,
        Cookie: `XSRF-TOKEN=${initCookies['XSRF-TOKEN'].value}`,
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    assert(loginRes.status === 200, 'Login succeeds with HTTP 200');
    const loginCookies = parseSetCookies(loginRes);
    assert(Boolean(loginCookies['refreshToken']), 'Login sets refreshToken cookie');
    assert(loginCookies['refreshToken'].isHttpOnly === true, 'refreshToken cookie is HttpOnly');
    assert(loginCookies['refreshToken'].isSameSiteStrict === true, 'refreshToken cookie has SameSite=Strict');
    assert(loginCookies['refreshToken'].path === '/', 'refreshToken cookie has Path=/');

    const rawTokenA = loginCookies['refreshToken'].value;
    const [tokenIdA] = rawTokenA.split('.');
    const docA = await RefreshToken.findById(tokenIdA);
    assert(Boolean(docA), 'Token A exists in database');
    assert(docA.isRotated === false, 'Token A is initially NOT rotated (isRotated: false)');
    assert(Boolean(docA.familyId), 'Token A is assigned a session familyId');
    const initialFamilyId = docA.familyId;

    let currentCsrfToken = loginCookies['XSRF-TOKEN'] ? loginCookies['XSRF-TOKEN'].value : csrfToken1;

    // --------------------------------------------------------------------------
    // Phase 2: Sequential Rotation (Token A -> Token B)
    // --------------------------------------------------------------------------
    console.log('\n🔄 Phase 2: First Refresh Token Rotation (Token A -> Token B)...');

    const refreshRes1 = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': currentCsrfToken,
        Cookie: `refreshToken=${rawTokenA}; XSRF-TOKEN=${currentCsrfToken}`,
      },
    });

    assert(refreshRes1.status === 200, 'POST /api/auth/refresh with Token A succeeds with HTTP 200');
    const refreshData1 = await refreshRes1.json();
    assert(Boolean(refreshData1.accessToken), 'Refresh endpoint returns fresh access token');
    assert(Boolean(refreshData1.csrfToken), 'Refresh endpoint returns rotated CSRF token');

    const refreshCookies1 = parseSetCookies(refreshRes1);
    assert(Boolean(refreshCookies1['refreshToken']), 'Refresh endpoint issues new refreshToken cookie');
    const rawTokenB = refreshCookies1['refreshToken'].value;
    assert(rawTokenB !== rawTokenA, 'New refreshToken B is distinct from original Token A');

    const [tokenIdB] = rawTokenB.split('.');
    const updatedDocA = await RefreshToken.findById(tokenIdA);
    const docB = await RefreshToken.findById(tokenIdB);

    assert(updatedDocA.isRotated === true, 'Old Token A is now marked as rotated (isRotated: true)');
    assert(docB.isRotated === false, 'New Token B is active (isRotated: false)');
    assert(docB.familyId === initialFamilyId, 'New Token B inherits the same session familyId');

    currentCsrfToken = refreshData1.csrfToken;

    // --------------------------------------------------------------------------
    // Phase 3: Chained Rotation (Token B -> Token C)
    // --------------------------------------------------------------------------
    console.log('\n🔄 Phase 3: Chained Rotation (Token B -> Token C)...');

    const refreshRes2 = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': currentCsrfToken,
        Cookie: `refreshToken=${rawTokenB}; XSRF-TOKEN=${currentCsrfToken}`,
      },
    });

    assert(refreshRes2.status === 200, 'POST /api/auth/refresh with Token B succeeds with HTTP 200');
    const refreshData2 = await refreshRes2.json();
    const refreshCookies2 = parseSetCookies(refreshRes2);
    const rawTokenC = refreshCookies2['refreshToken'].value;
    const [tokenIdC] = rawTokenC.split('.');

    const updatedDocB = await RefreshToken.findById(tokenIdB);
    const docC = await RefreshToken.findById(tokenIdC);

    assert(updatedDocB.isRotated === true, 'Token B is now marked as rotated (isRotated: true)');
    assert(docC.isRotated === false, 'Token C is active (isRotated: false)');
    assert(docC.familyId === initialFamilyId, 'Token C remains within the same session family');

    currentCsrfToken = refreshData2.csrfToken;

    // --------------------------------------------------------------------------
    // Phase 4: Replay Attack Detection & Session Family Invalidation
    // --------------------------------------------------------------------------
    console.log('\n🚨 Phase 4: Simulating Token Replay / Theft Attack (Presenting Rotated Token A)...');

    // Attacker presents already-rotated Token A
    const replayRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': currentCsrfToken,
        Cookie: `refreshToken=${rawTokenA}; XSRF-TOKEN=${currentCsrfToken}`,
      },
    });

    assert(replayRes.status === 403, 'Replay of rotated Token A is rejected with HTTP 403 Forbidden');
    const replayData = await replayRes.json();
    assert(
      replayData.message === 'Session reuse detected. For your security, please log in again.',
      'Returns plain English error message per NFR-47'
    );

    // Verify response clears cookies
    const replayCookies = parseSetCookies(replayRes);
    assert(replayCookies['refreshToken'] && replayCookies['refreshToken'].value === '', 'Replay response clears refreshToken cookie');
    assert(replayCookies['refreshToken'].path === '/', 'refreshToken cookie clear maintains Path=/');
    assert(replayCookies['refreshToken'].isSameSiteStrict === true, 'refreshToken cookie clear maintains SameSite=Strict');

    // Verify entire family is purged from MongoDB
    const remainingFamilyDocs = await RefreshToken.find({ familyId: initialFamilyId });
    assert(remainingFamilyDocs.length === 0, 'Entire session family (Tokens A, B, C) is completely deleted from MongoDB');

    // --------------------------------------------------------------------------
    // Phase 5: Victim & Attacker Lockout Verification
    // --------------------------------------------------------------------------
    console.log('\n🔒 Phase 5: Verifying Legitimate User Lockout (Presentation of Token C after Invalidation)...');

    const victimRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': currentCsrfToken,
        Cookie: `refreshToken=${rawTokenC}; XSRF-TOKEN=${currentCsrfToken}`,
      },
    });

    assert(victimRes.status === 401, 'Subsequent presentation of Token C returns HTTP 401 Unauthorized');
    const victimData = await victimRes.json();
    assert(
      victimData.message === 'Your session is invalid. Please log in again.',
      'Victim receives plain English re-authentication prompt'
    );

    // --------------------------------------------------------------------------
    // Phase 6: Atomic Concurrency & Race Condition Defense
    // --------------------------------------------------------------------------
    console.log('\n⚡ Phase 6: Verifying Atomic Concurrency / Simultaneous Refresh Race Protection...');

    // Generate fresh session token
    const sessionD = await RefreshToken.generate(testUser._id, null, 'Concurrent Test Device');
    const rawTokenD = sessionD.plaintext;
    const docD = sessionD.doc;
    const familyD = docD.familyId;

    // Issue valid CSRF token
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf-token`);
    const csrfData = await csrfRes.json();
    const tokenForRace = csrfData.csrfToken;

    // Launch two simultaneous refresh requests presenting the exact same Token D
    const [raceRes1, raceRes2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': tokenForRace,
          Cookie: `refreshToken=${rawTokenD}; XSRF-TOKEN=${tokenForRace}`,
        },
      }),
      fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': tokenForRace,
          Cookie: `refreshToken=${rawTokenD}; XSRF-TOKEN=${tokenForRace}`,
        },
      }),
    ]);

    const statuses = [raceRes1.status, raceRes2.status].sort();
    console.log(`  ℹ️ Concurrent refresh responses: ${raceRes1.status} and ${raceRes2.status}`);

    // Because the second concurrent request hits findOneAndUpdate({ isRotated: false }) while the first is rotating,
    // or arrives immediately after rotation, it detects reuse and returns 403 while purging the family.
    const hasOne200 = statuses.includes(200);
    const hasOne403 = statuses.includes(403);
    assert(hasOne403, 'Concurrent attempt triggers reuse detection with HTTP 403 Forbidden');
    
    // Check database state after concurrent attack
    const docsInFamilyD = await RefreshToken.find({ familyId: familyD });
    assert(
      docsInFamilyD.length === 0,
      'Family D is invalidated due to concurrent reuse detection'
    );

    // --------------------------------------------------------------------------
    // Phase 7: Session Management & Remote Revocation (FR-07 Synergy)
    // --------------------------------------------------------------------------
    console.log('\n📱 Phase 7: Session Family Listing & Remote Revocation (FR-07)...');

    // Clean any prior session tokens for testUser to isolate Phase 7 testing
    await RefreshToken.deleteMany({ user: testUser._id });

    // Create Device 1 session
    const dev1 = await RefreshToken.generate(testUser._id, null, 'Firefox on Linux');
    const rawDev1Token = dev1.plaintext;
    const familyDev1 = dev1.doc.familyId;

    // Create Device 2 session
    const dev2 = await RefreshToken.generate(testUser._id, null, 'Safari on iPhone');
    const rawDev2Token = dev2.plaintext;
    const familyDev2 = dev2.doc.familyId;

    // Generate access token for testUser
    const testAccessToken = jwt.sign({ userId: testUser._id, type: 'access' }, require('../utils/keys').privateKey, {
      algorithm: 'RS256',
      expiresIn: '15m',
    });

    // Device 1 rotates its token (creates rotated doc + new active doc in Family 1)
    const rotateDev1Res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': tokenForRace,
        'User-Agent': 'Firefox on Linux',
        Cookie: `refreshToken=${rawDev1Token}; XSRF-TOKEN=${tokenForRace}`,
      },
    });
    assert(rotateDev1Res.status === 200, 'Device 1 successfully rotates token');
    const dev1RotatedCookies = parseSetCookies(rotateDev1Res);
    const rawDev1NewToken = dev1RotatedCookies['refreshToken'].value;

    // Call GET /api/auth/sessions as Device 1
    const sessionsRes = await fetch(`${baseUrl}/api/auth/sessions`, {
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        Cookie: `refreshToken=${rawDev1NewToken}`,
      },
    });

    assert(sessionsRes.status === 200, 'GET /api/auth/sessions returns HTTP 200');
    const sessionsData = await sessionsRes.json();
    assert(Array.isArray(sessionsData.sessions), 'Returns sessions array');
    assert(
      sessionsData.sessions.length === 2,
      'Only 2 active sessions returned (rotated token is excluded from active list)'
    );

    const currentSession = sessionsData.sessions.find((s) => s.isCurrent === true);
    assert(Boolean(currentSession), 'Current session is identified');
    assert(currentSession.deviceInfo.includes('Linux'), 'Current session accurately matches Device 1');

    const otherSession = sessionsData.sessions.find((s) => s.isCurrent === false);
    assert(Boolean(otherSession), 'Other active session (Device 2) is identified');
    assert(otherSession.deviceInfo.includes('iPhone'), 'Other session accurately matches Device 2');

    // Revoke Device 2 via DELETE /api/auth/sessions/:id
    const revokeOneRes = await fetch(`${baseUrl}/api/auth/sessions/${otherSession._id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        'X-CSRF-Token': tokenForRace,
        Cookie: `XSRF-TOKEN=${tokenForRace}`,
      },
    });
    assert(revokeOneRes.status === 200, 'DELETE /api/auth/sessions/:id succeeds with HTTP 200');

    // Verify Device 2 family is purged, but Device 1 family is intact
    const remainingDev2Docs = await RefreshToken.find({ familyId: familyDev2 });
    assert(remainingDev2Docs.length === 0, 'Device 2 session family is completely purged');

    const remainingDev1Docs = await RefreshToken.find({ familyId: familyDev1 });
    assert(remainingDev1Docs.length > 0, 'Device 1 session family remains active and intact');

    // Create Device 3 and Device 4
    const dev3 = await RefreshToken.generate(testUser._id, null, 'Chrome on Windows');
    const dev4 = await RefreshToken.generate(testUser._id, null, 'Edge on Tablet');

    // Revoke all OTHER sessions via DELETE /api/auth/sessions
    const revokeAllOtherRes = await fetch(`${baseUrl}/api/auth/sessions`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${testAccessToken}`,
        'X-CSRF-Token': tokenForRace,
        Cookie: `refreshToken=${rawDev1NewToken}; XSRF-TOKEN=${tokenForRace}`,
      },
    });
    assert(revokeAllOtherRes.status === 200, 'DELETE /api/auth/sessions (revoke other) succeeds with HTTP 200');

    const dev3Docs = await RefreshToken.find({ familyId: dev3.doc.familyId });
    const dev4Docs = await RefreshToken.find({ familyId: dev4.doc.familyId });
    assert(dev3Docs.length === 0 && dev4Docs.length === 0, 'All other session families are purged');

    const finalDev1Docs = await RefreshToken.find({ familyId: familyDev1 });
    assert(finalDev1Docs.length > 0, 'Current session family was NOT affected by revoke-all-others');

    // --------------------------------------------------------------------------
    // Phase 8: Expired Token Rejection
    // --------------------------------------------------------------------------
    console.log('\n⏰ Phase 8: Verifying Natural Expiry Handling...');

    const expiredSession = await RefreshToken.generate(testUser._id, null, 'Expired Device');
    // Force expiry in database
    await RefreshToken.findByIdAndUpdate(expiredSession.doc._id, {
      expiresAt: new Date(Date.now() - 60000), // 1 minute ago
    });

    const expiredRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': tokenForRace,
        Cookie: `refreshToken=${expiredSession.plaintext}; XSRF-TOKEN=${tokenForRace}`,
      },
    });

    assert(expiredRes.status === 401, 'Expired refresh token returns HTTP 401');
    const expiredData = await expiredRes.json();
    assert(
      expiredData.message === 'Your session has expired. Please log in again.',
      'Expired token returns plain English expiration notice'
    );
    const expiredDocs = await RefreshToken.find({ familyId: expiredSession.doc.familyId });
    assert(expiredDocs.length === 0, 'Expired session family is deleted upon access attempt');

  } finally {
    // Teardown
    await User.findByIdAndDelete(testUser._id);
    await RefreshToken.deleteMany({ user: testUser._id });
    await new Promise((resolve) => testServer.close(resolve));
    await mongoose.connection.close(false);
  }

  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ NFR-13 Refresh Token Rotation tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-13 REFRESH TOKEN ROTATION REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
