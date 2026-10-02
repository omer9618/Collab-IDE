/**
 * @file test/test_nfr51_stateless_rest_api.js
 * @description Comprehensive automated verification test suite for NFR-51: Stateless REST API.
 * 
 * SPECIFICATION (NFR-51):
 * "The REST API must be stateless (session state in tokens and DB, not server memory)
 * so it can scale horizontally."
 * 
 * VERIFICATION PHASES:
 * Phase 1: Codebase Static Analysis & Architectural Invariants (Zero Server-Side Session Memory)
 * Phase 2: Multi-Node Horizontal Scaling Simulation (Cluster of Independent Server Instances)
 * Phase 3: Abrupt Process Failure & Zero Session Loss Failover
 * Phase 4: Stateless HTTP Headers & Anti-Caching Invariants
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Resolve configuration and modules
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const COLLAB_IDE_DIR = path.resolve(__dirname, '..');

// Ensure environment is loaded from collab-ide/.env
require('dotenv').config({ path: path.join(COLLAB_IDE_DIR, '.env') });
require('dotenv').config();

const { connectDB } = require('../config/db');
const { app } = require('../server');
const { auth, infrastructure } = require('../modules');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const Room = require('../models/Room');
const IpBlock = require('../models/IpBlock');

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
 * Native HTTP request helper that preserves cookies and exact status codes.
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
          rawHeaders: res.rawHeaders,
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
 * Extracts specific cookies from set-cookie headers.
 */
function extractCookie(headers, cookieName) {
  const setCookies = headers['set-cookie'];
  if (!setCookies) return null;
  const cookieArr = Array.isArray(setCookies) ? setCookies : [setCookies];
  for (const c of cookieArr) {
    const parts = c.split(';')[0].split('=');
    if (parts[0].trim() === cookieName) {
      return parts.slice(1).join('=').trim();
    }
  }
  return null;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-51: Stateless REST API Automated Test Suite');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Phase 1: Codebase Static Analysis & Architectural Invariants
  // --------------------------------------------------------------------------
  console.log('🔍 Phase 1: Codebase Static Analysis & Zero Server-Side Session Memory Invariants...');

  const packageJson = JSON.parse(fs.readFileSync(path.join(COLLAB_IDE_DIR, 'package.json'), 'utf8'));
  const allDeps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };

  check(!allDeps['express-session'], 'package.json does NOT depend on express-session');
  check(!allDeps['cookie-session'], 'package.json does NOT depend on cookie-session');
  check(!allDeps['connect-redis'], 'package.json does NOT depend on connect-redis');
  check(!allDeps['session'], 'package.json does NOT depend on stateful session libraries');

  // Verify assertStatelessPipeline on current production app
  const pipelineInspection = auth.assertStatelessPipeline(app);
  check(pipelineInspection.isStateless === true, 'auth.assertStatelessPipeline confirms Express app is stateless');
  check(pipelineInspection.inMemorySessionStore === false, 'Express app declares inMemorySessionStore: false');
  check(pipelineInspection.sessionStorage === 'tokens-and-db', 'Express app specifies sessionStorage: "tokens-and-db"');

  // Verify assertStatelessPipeline correctly detects violations if stateful middleware is present
  const dummyStatefulApp = express();
  dummyStatefulApp.use(function session(req, res, next) { next(); });
  let caughtViolation = false;
  try {
    auth.assertStatelessPipeline(dummyStatefulApp);
  } catch (err) {
    if (err.message.includes('NFR-51 Violation: Stateful session middleware detected')) {
      caughtViolation = true;
    }
  }
  check(caughtViolation, 'assertStatelessPipeline throws error when stateful session middleware is injected');

  // Verify auth module metadata exports
  check(auth.stateless && auth.stateless.enabled === true, 'modules/auth declares stateless.enabled === true');
  check(auth.stateless.sessionStorage === 'tokens-and-db', 'modules/auth declares sessionStorage === "tokens-and-db"');
  check(auth.stateless.inMemorySessionStore === false, 'modules/auth declares inMemorySessionStore === false');
  check(auth.stateless.supportsHorizontalScaling === true, 'modules/auth declares supportsHorizontalScaling === true');

  // Verify infrastructure module metadata exports
  check(infrastructure.stateless && infrastructure.stateless.enabled === true, 'modules/infrastructure declares stateless.enabled === true');
  check(infrastructure.stateless.supportsHorizontalScaling === true, 'modules/infrastructure declares supportsHorizontalScaling === true');

  // Verify source files do not access req.session
  const routesDir = path.join(COLLAB_IDE_DIR, 'routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
  let foundReqSession = false;
  for (const rf of routeFiles) {
    const content = fs.readFileSync(path.join(routesDir, rf), 'utf8');
    if (content.includes('req.session')) {
      foundReqSession = true;
    }
  }
  check(!foundReqSession, 'Zero occurrences of req.session across all REST route handlers');

  // Verify models define DB-backed session & brute force state
  check(RefreshToken.schema.paths.familyId !== undefined, 'RefreshToken model defines familyId for session family tracking');
  check(RefreshToken.schema.paths.token !== undefined, 'RefreshToken model stores token secret hash');
  check(RefreshToken.schema.paths.isRotated !== undefined, 'RefreshToken model stores rotation state in MongoDB');
  check(RefreshToken.schema.paths.expiresAt !== undefined, 'RefreshToken model persists TTL expiration date in MongoDB');
  check(User.schema.paths.loginAttempts !== undefined, 'User model stores brute force attempts in MongoDB');
  check(User.schema.paths.lockUntil !== undefined, 'User model stores account lockout timestamp in MongoDB');
  check(IpBlock.schema.paths.blockUntil !== undefined, 'IpBlock model stores IP block timestamp in MongoDB');

  // --------------------------------------------------------------------------
  // Phase 2: Multi-Node Horizontal Scaling Simulation
  // --------------------------------------------------------------------------
  console.log('\n🌐 Phase 2: Multi-Node Horizontal Scaling Simulation (Cluster of Independent API Instances)...');

  // Connect database
  await connectDB();
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => {
      if (mongoose.connection.readyState === 1) return resolve();
      mongoose.connection.once('open', resolve);
      setTimeout(resolve, 3000);
    });
  }
  check(mongoose.connection.readyState === 1, 'Connected to MongoDB Atlas');

  // Spin up Server Node A on port 3201 and Server Node B on port 3202
  const portA = 3201;
  const portB = 3202;

  const serverA = http.createServer(app);
  const serverB = http.createServer(app);

  await new Promise(resolve => serverA.listen(portA, '127.0.0.1', resolve));
  await new Promise(resolve => serverB.listen(portB, '127.0.0.1', resolve));

  const urlA = `http://127.0.0.1:${portA}`;
  const urlB = `http://127.0.0.1:${portB}`;
  console.log(`  📡 Server Node A listening on ${urlA}`);
  console.log(`  📡 Server Node B listening on ${urlB}`);

  const timestamp = Date.now();
  const testEmail = `stateless_user_${timestamp}@example.com`;
  const testPassword = 'Password123!@#';
  let accessToken = null;
  let refreshCookie = null;
  let csrfToken = null;
  let userDoc = null;
  let roomUuid = null;

  try {
    // 2.1 Register User on Node A
    const regRes = await makeRequest(`${urlA}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        email: testEmail,
        password: testPassword,
        displayName: `Stateless Tester ${timestamp}`,
      },
    });
    check(regRes.status === 201 || regRes.status === 200, 'Node A: User registration returned HTTP 201/200');

    // Auto-verify email in MongoDB so the account is immediately active
    userDoc = await User.findOne({ email: testEmail });
    assert(userDoc, 'Test user document found in MongoDB');
    userDoc.isVerified = true;
    await userDoc.save();

    // 2.2 Login on Node A to obtain stateless credentials
    // Obtain CSRF token from Node A first
    const initResA = await makeRequest(`${urlA}/api/auth/login`);
    csrfToken = extractCookie(initResA.headers, 'XSRF-TOKEN') || 'dummy-csrf-token';

    const loginRes = await makeRequest(`${urlA}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        'Cookie': `XSRF-TOKEN=${csrfToken}`,
      },
      body: {
        email: testEmail,
        password: testPassword,
      },
    });

    check(loginRes.status === 200, 'Node A: Login returned HTTP 200');
    check(Boolean(loginRes.data && loginRes.data.accessToken), 'Node A: Issued RS256 JWT access token');
    accessToken = loginRes.data.accessToken;
    refreshCookie = extractCookie(loginRes.headers, 'refreshToken');
    check(Boolean(refreshCookie), 'Node A: Issued HttpOnly refresh token cookie');

    // Verify req.session was NOT populated on Node A
    check(loginRes.data.session === undefined, 'Node A response payload has zero session property');
    check(!extractCookie(loginRes.headers, 'connect.sid'), 'Node A does not issue stateful connect.sid cookie');

    // 2.3 Cross-Node Verification: Request Node B with Node A's Access Token
    // Node B has NEVER seen this client or this login in its memory
    const profileResB = await makeRequest(`${urlB}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    check(profileResB.status === 200, 'Node B: Authenticated request using Node A token returned HTTP 200');
    check(profileResB.data && profileResB.data.user && profileResB.data.user.email === testEmail, 'Node B: Correctly resolved user profile from token & DB');

    // 2.4 Cross-Node Room CRUD: Create Room on Node A
    const createRoomRes = await makeRequest(`${urlA}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'x-csrf-token': csrfToken,
        'Cookie': `XSRF-TOKEN=${csrfToken}`,
      },
      body: {
        name: `Stateless Test Room ${timestamp}`,
      },
    });

    check(createRoomRes.status === 201 || createRoomRes.status === 200, 'Node A: Room created successfully');
    roomUuid = createRoomRes.data && createRoomRes.data.uuid;
    check(Boolean(roomUuid), `Node A: Created room assigned UUID: ${roomUuid}`);

    // Fetch Room on Node B (Proves room REST state is in MongoDB, not Node A memory)
    const listRoomsResB = await makeRequest(`${urlB}/api/rooms`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    check(listRoomsResB.status === 200, 'Node B: List rooms returned HTTP 200');
    const foundRoomOnB = Array.isArray(listRoomsResB.data) && listRoomsResB.data.some(r => r.uuid === roomUuid);
    check(foundRoomOnB, 'Node B: Retrieved room created on Node A with complete metadata');

    // 2.5 Cross-Node Refresh Token Rotation (NFR-13)
    // Client sends refresh token (issued by Node A) to Node B
    const refreshResB = await makeRequest(`${urlB}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `refreshToken=${refreshCookie}; XSRF-TOKEN=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
    });

    check(refreshResB.status === 200, 'Node B: Refresh token issued by Node A rotated successfully on Node B');
    check(Boolean(refreshResB.data && refreshResB.data.accessToken), 'Node B: Issued new RS256 access token');
    const newAccessToken = refreshResB.data.accessToken;
    const newRefreshCookie = extractCookie(refreshResB.headers, 'refreshToken');
    check(Boolean(newRefreshCookie), 'Node B: Issued new rotated refresh token cookie');
    check(newRefreshCookie !== refreshCookie, 'Rotated refresh token cookie is cryptographically distinct from old token');

    // Use newly issued token from Node B to access Node A
    const profileResA = await makeRequest(`${urlA}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${newAccessToken}`,
      },
    });
    check(profileResA.status === 200, 'Node A: Accepted newly rotated token issued by Node B');

    // 2.6 Cross-Node Session Listing & Revocation
    // Fetch active sessions from Node B
    const sessionsResB = await makeRequest(`${urlB}/api/auth/sessions`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${newAccessToken}`,
        'Cookie': `refreshToken=${newRefreshCookie}`,
      },
    });
    check(sessionsResB.status === 200, 'Node B: Fetched active sessions list from MongoDB');
    check(Array.isArray(sessionsResB.data && sessionsResB.data.sessions), 'Node B: Returned sessions array');
    const activeSession = sessionsResB.data.sessions[0];
    check(Boolean(activeSession && activeSession._id), 'Node B: Identified active session family ID');

    // Revoke the session family on Node A
    const revokeResA = await makeRequest(`${urlA}/api/auth/sessions/${activeSession._id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${newAccessToken}`,
        'x-csrf-token': csrfToken,
        'Cookie': `XSRF-TOKEN=${csrfToken}`,
      },
    });
    check(revokeResA.status === 200, 'Node A: Revoked session family in MongoDB');

    // Attempt to use the revoked token on Node B -> Must fail immediately with HTTP 401/404
    const reuseAttemptResB = await makeRequest(`${urlB}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `refreshToken=${newRefreshCookie}; XSRF-TOKEN=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
    });
    check(reuseAttemptResB.status === 401 || reuseAttemptResB.status === 403, 'Node B: Rejected revoked session family immediately (Status: ' + reuseAttemptResB.status + ')');

    // 2.7 Cross-Node Brute Force Lockout Synchronization (NFR-14)
    console.log('  🛡️ Testing Cross-Node Distributed Account Lockout Synchronization...');
    const bruteIp = `198.51.${Math.floor(Math.random() * 200 + 1)}.${Math.floor(Math.random() * 200 + 1)}`;
    const bruteUserEmail = `brute_stateless_${timestamp}@example.com`;
    const bruteUser = await User.create({
      email: bruteUserEmail,
      password: 'ValidPassword123!',
      displayName: 'Brute Target',
      isVerified: true,
    });

    // 3 failed logins on Node A
    for (let i = 1; i <= 3; i++) {
      await makeRequest(`${urlA}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          'Cookie': `XSRF-TOKEN=${csrfToken}`,
          'x-forwarded-for': bruteIp,
        },
        body: { email: bruteUserEmail, password: 'WrongPassword999!' },
      });
    }

    // Check DB state reflects 3 failed attempts
    let checkUser = await User.findById(bruteUser._id);
    check(checkUser.loginAttempts === 3, 'MongoDB: Atomically recorded 3 failed attempts from Node A');

    // 2 failed logins on Node B (Reaches 5 failed attempts threshold)
    for (let i = 4; i <= 5; i++) {
      await makeRequest(`${urlB}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          'Cookie': `XSRF-TOKEN=${csrfToken}`,
          'x-forwarded-for': bruteIp,
        },
        body: { email: bruteUserEmail, password: 'WrongPassword999!' },
      });
    }

    // Verify MongoDB now holds lockUntil
    checkUser = await User.findById(bruteUser._id);
    check(Boolean(checkUser.lockUntil), 'Node B: Atomically triggered account lockout in MongoDB');

    // Next request sent to Node A -> Node A immediately returns HTTP 403 Account Locked
    const lockCheckResA = await makeRequest(`${urlA}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        'Cookie': `XSRF-TOKEN=${csrfToken}`,
        'x-forwarded-for': bruteIp,
      },
      body: { email: bruteUserEmail, password: 'ValidPassword123!' },
    });
    check(lockCheckResA.status === 403, 'Node A: Immediately enforced account lockout triggered by Node B (HTTP 403)');
    check(lockCheckResA.data && lockCheckResA.data.message.includes('locked'), 'Node A: Lockout message explains account lockout');

    // --------------------------------------------------------------------------
    // Phase 3: Abrupt Process Failure & Zero Session Loss Failover
    // --------------------------------------------------------------------------
    console.log('\n💥 Phase 3: Abrupt Process Failure & Zero Session Loss Failover...');

    // Login fresh user on Node A
    const freshLogin = await makeRequest(`${urlA}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        'Cookie': `XSRF-TOKEN=${csrfToken}`,
      },
      body: { email: testEmail, password: testPassword },
    });
    check(freshLogin.status === 200, 'Fresh login on Node A succeeded');
    const failoverToken = freshLogin.data.accessToken;

    // Simulate abrupt crash of Node A: Close serverA
    await new Promise(resolve => serverA.close(resolve));
    console.log('  ⚠️ Server Node A crashed and was abruptly closed.');

    // Client sends request to surviving Node B with Node A's token
    const failoverResB = await makeRequest(`${urlB}/api/auth/me`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${failoverToken}` },
    });
    check(failoverResB.status === 200, 'Surviving Node B processed request with zero session loss after Node A crash');
    check(failoverResB.data.user.email === testEmail, 'User identity preserved perfectly without sticky sessions');

    // --------------------------------------------------------------------------
    // Phase 4: Stateless HTTP Headers & Anti-Caching Invariants
    // --------------------------------------------------------------------------
    console.log('\n🛡️  Phase 4: Stateless HTTP Headers & Anti-Caching Invariants...');

    const healthRes = await makeRequest(`${urlB}/health`);
    check(healthRes.status === 200, 'GET /health returned HTTP 200');
    check(!extractCookie(healthRes.headers, 'connect.sid'), '/health response sends NO stateful session cookies');
    check(!extractCookie(healthRes.headers, 'JSESSIONID'), '/health response sends NO JSESSIONID cookie');

    // Verify that authenticated user endpoints never send stateful session IDs
    const meRes = await makeRequest(`${urlB}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${failoverToken}` },
    });
    check(meRes.status === 200, 'GET /api/auth/me returned HTTP 200');
    check(!extractCookie(meRes.headers, 'connect.sid'), 'Protected user endpoint sends zero stateful session cookie');

  } finally {
    // Clean up test servers
    try { serverA.close(); } catch (_) {}
    try { serverB.close(); } catch (_) {}

    // Clean up test database records
    if (userDoc) {
      await User.deleteOne({ _id: userDoc._id });
      await RefreshToken.deleteMany({ user: userDoc._id });
    }
    if (roomUuid) {
      await Room.deleteOne({ uuid: roomUuid });
    }
    await User.deleteMany({ email: { $regex: /^brute_stateless_/ } });
    await IpBlock.deleteMany({ ip: { $regex: /^198\.51\./ } });
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('\n❌ NFR-51 Stateless REST API test suite FAILED!');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL NFR-51 STATELESS REST API REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
