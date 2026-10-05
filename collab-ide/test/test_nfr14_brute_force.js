/**
 * ==============================================================================
 * CollabIDE - NFR-14: Brute Force Prevention Test Suite
 * ==============================================================================
 * 
 * Verifies NFR-14 requirements:
 * 1. Per-Email Lockout: 5 failed login attempts in 10 minutes -> 15-minute lockout.
 * 2. Per-IP Block: 20 failed login attempts across any accounts in 10 minutes -> 1-hour block.
 * 3. 10-Minute Sliding Window: Inactivity or spacing exceeding 10 minutes resets counters.
 * 4. Post-Ban Recovery: Once 15m (email) or 1h (IP) expires, counters cleanly reset
 *    to attempt 1 in a fresh 10-minute window without lingering state.
 * 5. Concurrency Resilience:
 *    - 10 simultaneous failed logins against the same email trigger exactly ONE lockout.
 *    - 30 simultaneous failed logins from a new IP trigger exactly ONE block, handling
 *      E11000 duplicate key races cleanly without dropping increments.
 * 6. Ingress Pre-Bcrypt Rejection: Locked accounts reject immediately with HTTP 403
 *    before executing expensive bcrypt.compare operations.
 * 7. Ingress IP Block Rejection: Blocked IPs reject immediately with HTTP 429 Too Many Requests.
 * 8. Audit Logging: All lockout, block, and rejected-attempt events emit structured
 *    audit logs containing client IP and ISO timestamp.
 */

process.env.NODE_ENV = 'test';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const mongoose = require('mongoose');

const User = require('../models/User');
const IpBlock = require('../models/IpBlock');
const logger = require('../utils/logger');
const { app } = require('../server');
const {
  recordFailedAccountAttempt,
  recordFailedIpAttempt,
  ipBruteForceLimiter,
  handleFailedLogin,
} = require('../routes/auth');

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

// Intercept logger.warn to capture security audit events
const capturedAuditLogs = [];
const originalLoggerWarn = logger.warn;
logger.warn = function (msg, meta) {
  if (typeof msg === 'string' && msg.includes('[AUDIT] [SECURITY]')) {
    capturedAuditLogs.push({ msg, meta });
  }
  return originalLoggerWarn.apply(this, arguments);
};

// Helper to parse cookies from Set-Cookie headers
function parseSetCookies(res) {
  const headers = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const rawHeader = res.headers.get('set-cookie');
  const allHeaders = headers.length > 0 ? headers : (rawHeader ? rawHeader.split(/,(?=\s*[^;]+=[^;]+)/) : []);
  
  const cookies = {};
  allHeaders.forEach((str) => {
    const parts = str.split(';').map((p) => p.trim());
    const [nameVal] = parts;
    const [name, val] = nameVal.split('=');
    if (name) {
      cookies[name.trim()] = {
        value: val ? decodeURIComponent(val.trim()) : '',
      };
    }
  });
  return cookies;
}

let ipCounter = 1;
const runSessionId = Math.floor(Math.random() * 200 + 10);
function getUniqueTestIp(prefix = '198.51.100') {
  return `${prefix}.${runSessionId}.${ipCounter++}`;
}

async function runTests() {
  console.log('\n================================================================');
  console.log('🛡️  Starting NFR-14: Brute Force Prevention & Lockout Test Suite');
  console.log('================================================================\n');

  // 1. Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI is not set in .env');
    process.exit(1);
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, { maxPoolSize: 10 });
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve) => mongoose.connection.once('open', resolve));
    }
  }
  assert(mongoose.connection.readyState === 1, 'Connected to MongoDB Atlas');

  // 2. Start Test Server on dedicated port
  const testPort = 3198;
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(testPort, resolve));
  const baseUrl = `http://127.0.0.1:${testPort}`;
  console.log(`📡 Test server listening on ${baseUrl}\n`);

  try {
    // --------------------------------------------------------------------------
    // Phase 1: Unit & Core Atomicity Tests (Account Lockout)
    // --------------------------------------------------------------------------
    console.log('📦 Phase 1: Account Lockout Atomicity & Sliding Window Tests');

    const testUserA = await User.create({
      email: `nfr14-userA-${Date.now()}@example.com`,
      password: 'Password123!',
      displayName: 'NFR14 User A',
      isVerified: true,
    });

    const now0 = Date.now();
    const testIpA = getUniqueTestIp('198.51.100');

    // Attempts 1 to 4 should increment without locking
    for (let i = 1; i <= 4; i++) {
      const res = await recordFailedAccountAttempt(testUserA, testIpA, now0 + i * 1000);
      assert(res.locked === false, `Attempt ${i} does not lock account`);
      assert(res.attempts === i, `Attempt ${i} returns correct count ${i}`);
    }

    // 5th attempt within 10 minutes must trigger 15-minute lockout
    const res5 = await recordFailedAccountAttempt(testUserA, testIpA, now0 + 5000);
    assert(res5.locked === true, '5th failed attempt locks the account');
    assert(Boolean(res5.lockUntil), '5th failed attempt returns lockUntil timestamp');
    const expectedLockTime = now0 + 5000 + 15 * 60 * 1000;
    const diffMs = Math.abs(new Date(res5.lockUntil).getTime() - expectedLockTime);
    assert(diffMs < 5000, 'lockUntil is set to 15 minutes in the future');

    // Verify DB state after lockout
    const userInDbA = await User.findById(testUserA._id);
    assert(userInDbA.loginAttempts === 0, 'loginAttempts is reset to 0 in DB upon lockout');
    assert(userInDbA.loginAttemptsWindowStart === undefined, 'loginAttemptsWindowStart is unset upon lockout');
    assert(userInDbA.lockUntil !== undefined, 'lockUntil is persisted in DB');

    // Verify Audit Log for ACCOUNT_LOCKOUT
    const lockoutLog = capturedAuditLogs.find((l) => l.meta && l.meta.event === 'ACCOUNT_LOCKOUT' && l.meta.userId.toString() === testUserA._id.toString());
    assert(Boolean(lockoutLog), 'ACCOUNT_LOCKOUT audit log emitted');
    assert(lockoutLog?.meta.ip === testIpA, 'ACCOUNT_LOCKOUT log contains client IP');
    assert(lockoutLog?.meta.durationMinutes === 15, 'ACCOUNT_LOCKOUT log records 15m duration');
    assert(Boolean(lockoutLog?.meta.timestamp), 'ACCOUNT_LOCKOUT log contains ISO timestamp');

    // Test: Sliding Window Expiration (4 failed attempts, then wait 11 minutes -> resets to 1, no lockout)
    console.log('\n⏳ Testing Account 10-Minute Sliding Window Expiration...');
    const testUserB = await User.create({
      email: `nfr14-userB-${Date.now()}@example.com`,
      password: 'Password123!',
      displayName: 'NFR14 User B',
      isVerified: true,
    });

    const windowStartB = Date.now();
    for (let i = 1; i <= 4; i++) {
      await recordFailedAccountAttempt(testUserB, testIpA, windowStartB + i * 1000);
    }
    const userBBefore = await User.findById(testUserB._id);
    assert(userBBefore.loginAttempts === 4, 'User B reached 4 failed attempts');

    // 5th attempt arrives at windowStartB + 11 minutes (> 10m window)
    const elevenMinutesLater = windowStartB + 11 * 60 * 1000;
    const resAfterExpiry = await recordFailedAccountAttempt(testUserB, testIpA, elevenMinutesLater);
    assert(resAfterExpiry.locked === false, 'Attempt after 10m window does NOT lock account');
    assert(resAfterExpiry.attempts === 1, 'Attempt after 10m window resets count to 1');
    const userBAfter = await User.findById(testUserB._id);
    assert(userBAfter.loginAttempts === 1, 'User B count reset to 1 in DB');
    assert(userBAfter.lockUntil === undefined, 'User B has no lockUntil in DB');

    // Test: Post-Lockout Expiration Clean Reset
    console.log('\n🔓 Testing Account Post-Lockout Expiration Recovery...');
    const sixteenMinutesLater = now0 + 5000 + 16 * 60 * 1000; // 16 min after lockout
    const resPostLock = await recordFailedAccountAttempt(testUserA, testIpA, sixteenMinutesLater);
    assert(resPostLock.locked === false, 'First failed attempt after 15m lockout expires does NOT re-lock');
    assert(resPostLock.attempts === 1, 'First failed attempt after lockout resets to attempt 1');
    const userARecovered = await User.findById(testUserA._id);
    assert(userARecovered.loginAttempts === 1, 'User A DB has loginAttempts = 1');
    assert(userARecovered.lockUntil === undefined, 'User A DB has lockUntil cleared');

    // Test: Concurrent Email Burst (10 Simultaneous Requests)
    console.log('\n⚡ Testing Concurrent Email Burst Protection (10 parallel requests)...');
    const testUserC = await User.create({
      email: `nfr14-userC-${Date.now()}@example.com`,
      password: 'Password123!',
      displayName: 'NFR14 User C',
      isVerified: true,
    });

    const burstNow = Date.now();
    const burstEmailIp = getUniqueTestIp('198.51.100');
    const burstPromises = Array.from({ length: 10 }, () =>
      recordFailedAccountAttempt(testUserC, burstEmailIp, burstNow)
    );
    const burstResults = await Promise.all(burstPromises);
    const lockEvents = burstResults.filter((r) => r.locked === true);
    assert(lockEvents.length === 1, 'Exactly ONE parallel request triggered the account lockout');
    const userCInDb = await User.findById(testUserC._id);
    assert(userCInDb.lockUntil !== undefined, 'User C has lockUntil set in DB');
    assert(userCInDb.loginAttempts === 0, 'User C loginAttempts is reset to 0 in DB');

    // --------------------------------------------------------------------------
    // Phase 2: Unit & Core Atomicity Tests (IP Block)
    // --------------------------------------------------------------------------
    console.log('\n📦 Phase 2: IP Block Atomicity & Sliding Window Tests');

    const testIpX = getUniqueTestIp('203.0.113');
    const ipNow0 = Date.now();

    // Attempts 1 to 19 should increment without blocking
    for (let i = 1; i <= 19; i++) {
      const res = await recordFailedIpAttempt(testIpX, ipNow0 + i * 500);
      assert(res.blocked === false, `IP attempt ${i} does not block IP`);
      assert(res.attempts === i, `IP attempt ${i} returns correct count ${i}`);
    }

    // 20th attempt within 10 minutes must trigger 1-hour block
    const res20 = await recordFailedIpAttempt(testIpX, ipNow0 + 10000);
    assert(res20.blocked === true, '20th failed attempt blocks the IP');
    assert(Boolean(res20.blockUntil), '20th failed attempt returns blockUntil timestamp');
    const expectedIpBlockTime = ipNow0 + 10000 + 60 * 60 * 1000;
    const ipDiffMs = Math.abs(new Date(res20.blockUntil).getTime() - expectedIpBlockTime);
    assert(ipDiffMs < 5000, 'blockUntil is set to 1 hour in the future');

    // Verify DB state for IP block
    const ipDocX = await IpBlock.findByIp(testIpX);
    assert(Boolean(ipDocX), 'IpBlock document found in DB');
    assert(ipDocX.failedAttempts === 0, 'failedAttempts is reset to 0 in DB upon IP block');
    assert(ipDocX.windowStart === undefined, 'windowStart is unset upon IP block');
    assert(ipDocX.blockUntil !== undefined, 'blockUntil is persisted in DB');

    // Verify Audit Log for IP_BLOCK
    const ipBlockLog = capturedAuditLogs.find((l) => l.meta && l.meta.event === 'IP_BLOCK' && l.meta.ip === testIpX);
    assert(Boolean(ipBlockLog), 'IP_BLOCK audit log emitted');
    assert(ipBlockLog?.meta.durationHours === 1, 'IP_BLOCK log records 1h duration');
    assert(ipBlockLog?.meta.failedAttempts === 20, 'IP_BLOCK log records 20 failed attempts');
    assert(Boolean(ipBlockLog?.meta.timestamp), 'IP_BLOCK log contains ISO timestamp');

    // Test: IP Sliding Window Expiration (19 attempts, then wait 11m -> resets to 1, no block)
    console.log('\n⏳ Testing IP 10-Minute Sliding Window Expiration...');
    const testIpY = getUniqueTestIp('203.0.113');
    const ipWindowY = Date.now();
    for (let i = 1; i <= 19; i++) {
      await recordFailedIpAttempt(testIpY, ipWindowY + i * 500);
    }
    const ipDocYBefore = await IpBlock.findByIp(testIpY);
    assert(ipDocYBefore.failedAttempts === 19, 'IP Y reached 19 failed attempts');

    const elevenMinsLaterIp = ipWindowY + 11 * 60 * 1000;
    const resAfterExpiryIp = await recordFailedIpAttempt(testIpY, elevenMinsLaterIp);
    assert(resAfterExpiryIp.blocked === false, 'Attempt after 10m window does NOT block IP');
    assert(resAfterExpiryIp.attempts === 1, 'Attempt after 10m window resets IP count to 1');
    const ipDocYAfter = await IpBlock.findByIp(testIpY);
    assert(ipDocYAfter.failedAttempts === 1, 'IP Y count reset to 1 in DB');
    assert(ipDocYAfter.blockUntil === undefined, 'IP Y has no blockUntil in DB');

    // Test: IP Post-Block Expiration Clean Reset
    console.log('\n🔓 Testing IP Post-Block Expiration Recovery...');
    const sixtyOneMinutesLater = ipNow0 + 10000 + 61 * 60 * 1000; // 61 min after block
    const resPostBlock = await recordFailedIpAttempt(testIpX, sixtyOneMinutesLater);
    assert(resPostBlock.blocked === false, 'First attempt after 1h block expires does NOT re-block');
    assert(resPostBlock.attempts === 1, 'First attempt after 1h block resets to attempt 1');
    const ipDocXRecovered = await IpBlock.findByIp(testIpX);
    assert(ipDocXRecovered.failedAttempts === 1, 'IP X DB has failedAttempts = 1');
    assert(ipDocXRecovered.blockUntil === undefined, 'IP X DB has blockUntil cleared');

    // Test: Concurrent IP Burst (30 Simultaneous Requests on brand new IP)
    console.log('\n⚡ Testing Concurrent IP Burst & E11000 Race Resilience (30 parallel requests)...');
    const testIpZ = getUniqueTestIp('192.0.2');
    const burstIpNow = Date.now();
    const ipBurstPromises = Array.from({ length: 30 }, () =>
      recordFailedIpAttempt(testIpZ, burstIpNow)
    );
    const ipBurstResults = await Promise.all(ipBurstPromises);
    const ipBlockEvents = ipBurstResults.filter((r) => r.blocked === true);
    assert(ipBlockEvents.length === 1, 'Exactly ONE parallel request triggered the IP block');
    const ipDocZInDb = await IpBlock.findByIp(testIpZ);
    assert(ipDocZInDb.blockUntil !== undefined, 'IP Z has blockUntil set in DB');
    assert(ipDocZInDb.failedAttempts === 0, 'IP Z failedAttempts is reset to 0 in DB');

    // --------------------------------------------------------------------------
    // Phase 3: End-to-End HTTP API Integration Tests
    // --------------------------------------------------------------------------
    console.log('\n🌐 Phase 3: End-to-End HTTP API Integration Tests');

    // Obtain CSRF token
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf-token`);
    const csrfData = await csrfRes.json();
    const csrfToken = csrfData.csrfToken;
    const csrfCookies = parseSetCookies(csrfRes);
    const cookieHeader = `XSRF-TOKEN=${csrfCookies['XSRF-TOKEN']?.value || ''}`;

    // Test 3.1: Account Lockout via HTTP POST /api/auth/login
    console.log('\n🔒 Testing HTTP Account Lockout (5 failed logins -> HTTP 403)...');
    const httpTargetEmail = `nfr14-http-target-${Date.now()}@example.com`;
    const httpTargetPassword = 'CorrectPassword123!';
    const httpUser = await User.create({
      email: httpTargetEmail,
      password: httpTargetPassword,
      displayName: 'HTTP Lockout Target',
      isVerified: true,
    });

    const httpTestIp1 = getUniqueTestIp('198.51.100');

    // 4 failed attempts with wrong password -> returns 401
    for (let i = 1; i <= 4; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Cookie: cookieHeader,
          'X-Forwarded-For': httpTestIp1,
        },
        body: JSON.stringify({ email: httpTargetEmail, password: 'WrongPassword999!' }),
      });
      assert(res.status === 401, `Failed login attempt ${i} returns HTTP 401`);
    }

    // 5th failed attempt -> returns 401 and atomically triggers 15m lockout in DB
    const res5Http = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookieHeader,
        'X-Forwarded-For': httpTestIp1,
      },
      body: JSON.stringify({ email: httpTargetEmail, password: 'WrongPassword999!' }),
    });
    assert(res5Http.status === 401, '5th failed login attempt returns HTTP 401');

    // 6th attempt (even with correct password!) must be rejected with HTTP 403 (Account Locked)
    const res6Locked = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookieHeader,
        'X-Forwarded-For': httpTestIp1,
      },
      body: JSON.stringify({ email: httpTargetEmail, password: httpTargetPassword }),
    });
    assert(res6Locked.status === 403, 'Subsequent login while locked returns HTTP 403');
    const lockBody = await res6Locked.json();
    assert(lockBody.message.includes('temporarily locked'), 'Response message explains account lockout');
    assert(lockBody.message.includes('minutes'), 'Response message specifies remaining minutes');

    // Verify LOCKED_ACCOUNT_REJECTED audit log
    const lockedRejectLog = capturedAuditLogs.find(
      (l) => l.meta && l.meta.event === 'LOCKED_ACCOUNT_REJECTED' && l.meta.userId.toString() === httpUser._id.toString()
    );
    assert(Boolean(lockedRejectLog), 'LOCKED_ACCOUNT_REJECTED audit log emitted');
    assert(lockedRejectLog?.meta.ip === httpTestIp1, 'LOCKED_ACCOUNT_REJECTED log contains client IP');

    // Test 3.2: Successful Login Resets Counter
    console.log('\n🔄 Testing HTTP Successful Login Counter Reset...');
    const httpResetEmail = `nfr14-http-reset-${Date.now()}@example.com`;
    const httpResetPassword = 'Password123!';
    const httpResetUser = await User.create({
      email: httpResetEmail,
      password: httpResetPassword,
      displayName: 'HTTP Reset User',
      isVerified: true,
    });

    const httpTestIp2 = getUniqueTestIp('198.51.100');

    // 3 failed logins
    for (let i = 1; i <= 3; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Cookie: cookieHeader,
          'X-Forwarded-For': httpTestIp2,
        },
        body: JSON.stringify({ email: httpResetEmail, password: 'BadPassword123!' }),
      });
    }

    const resetUserInDb1 = await User.findById(httpResetUser._id);
    assert(resetUserInDb1.loginAttempts === 3, 'User accumulated 3 failed attempts in DB');

    // 4th login is SUCCESSFUL
    const successRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookieHeader,
        'X-Forwarded-For': httpTestIp2,
      },
      body: JSON.stringify({ email: httpResetEmail, password: httpResetPassword }),
    });
    assert(successRes.status === 200, 'Successful login returns HTTP 200');

    const resetUserInDb2 = await User.findById(httpResetUser._id);
    assert(resetUserInDb2.loginAttempts === 0, 'Successful login resets loginAttempts to 0 in DB');
    assert(resetUserInDb2.loginAttemptsWindowStart === undefined, 'loginAttemptsWindowStart is cleared in DB');
    assert(resetUserInDb2.lockUntil === undefined, 'lockUntil is cleared in DB');

    // Test 3.3: IP Block via HTTP POST /api/auth/login (20 failed logins -> HTTP 429)
    console.log('\n🚫 Testing HTTP IP Block (20 failed attempts -> HTTP 429)...');
    const httpTestIp3 = getUniqueTestIp('203.0.113');

    // Send 20 failed login attempts across different emails
    for (let i = 1; i <= 20; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Cookie: cookieHeader,
          'X-Forwarded-For': httpTestIp3,
        },
        body: JSON.stringify({ email: `random-user-${i}-${Date.now()}@example.com`, password: 'RandomPassword123!' }),
      });
      assert(res.status === 401, `Failed login ${i} from IP returns HTTP 401`);
    }

    // 21st attempt from httpTestIp3 must be blocked by ipBruteForceLimiter with HTTP 429
    const blockedRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookieHeader,
        'X-Forwarded-For': httpTestIp3,
      },
      body: JSON.stringify({ email: httpResetEmail, password: httpResetPassword }),
    });
    assert(blockedRes.status === 429, '21st attempt from blocked IP returns HTTP 429 Too Many Requests');
    const blockedBody = await blockedRes.json();
    assert(blockedBody.message.includes('Too many failed login attempts from this IP'), 'Response message explains IP block');
    assert(typeof blockedBody.retryAfter === 'number' && blockedBody.retryAfter > 0, 'Response includes retryAfter seconds');

    // Verify BLOCKED_IP_REJECTED audit log
    const ipRejectLog = capturedAuditLogs.find(
      (l) => l.meta && l.meta.event === 'BLOCKED_IP_REJECTED' && l.meta.ip === httpTestIp3
    );
    assert(Boolean(ipRejectLog), 'BLOCKED_IP_REJECTED audit log emitted');
    assert(ipRejectLog?.meta.ip === httpTestIp3, 'BLOCKED_IP_REJECTED log contains client IP');

    // Test 3.4: IP Block Isolation (Other IPs are NOT blocked)
    console.log('\n🌐 Testing IP Block Isolation (different IP is unaffected)...');
    const httpTestIp4 = getUniqueTestIp('203.0.113');
    const otherIpRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookieHeader,
        'X-Forwarded-For': httpTestIp4,
      },
      body: JSON.stringify({ email: httpResetEmail, password: httpResetPassword }),
    });
    assert(otherIpRes.status === 200, 'Different IP is not blocked and succeeds with HTTP 200');

    // Test 3.5: Expired Ingress Lockout Auto-Clear
    console.log('\n⏱️ Testing Ingress Auto-Clear of Expired Account Lockout...');
    const expiredUser = await User.create({
      email: `nfr14-expired-${Date.now()}@example.com`,
      password: 'ExpiredPassword123!',
      displayName: 'Expired Lockout User',
      isVerified: true,
      lockUntil: new Date(Date.now() - 60 * 1000), // locked 1 minute ago, already expired
      loginAttempts: 5,
    });

    const expiredUserIp = getUniqueTestIp('198.51.100');
    const expiredRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookieHeader,
        'X-Forwarded-For': expiredUserIp,
      },
      body: JSON.stringify({ email: expiredUser.email, password: 'ExpiredPassword123!' }),
    });
    assert(expiredRes.status === 200, 'Expired account lockout allows login with HTTP 200');
    const expiredDbUser = await User.findById(expiredUser._id);
    assert(expiredDbUser.lockUntil === undefined, 'Expired lockUntil cleared from DB');
    assert(expiredDbUser.loginAttempts === 0, 'loginAttempts reset to 0 in DB');

    // Test 3.6: Expired Ingress IP Block Auto-Clear
    console.log('\n⏱️ Testing Ingress Auto-Clear of Expired IP Block...');
    const expiredIp = getUniqueTestIp('203.0.113');
    await IpBlock.create({
      ip: expiredIp,
      failedAttempts: 20,
      blockUntil: new Date(Date.now() - 60 * 1000), // expired 1 minute ago
    });

    const expiredIpRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookieHeader,
        'X-Forwarded-For': expiredIp,
      },
      body: JSON.stringify({ email: httpResetEmail, password: httpResetPassword }),
    });
    assert(expiredIpRes.status === 200, 'Expired IP block allows request through with HTTP 200');
    const expiredIpDoc = await IpBlock.findByIp(expiredIp);
    assert(expiredIpDoc.blockUntil === undefined, 'Expired blockUntil cleared from DB');
    assert(expiredIpDoc.failedAttempts === 0, 'failedAttempts reset to 0 in DB');

  } finally {
    // Teardown
    await new Promise((resolve) => testServer.close(resolve));
    console.log('\n🛑 Test server stopped.');
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('📊 NFR-14 Test Results Summary');
  console.log('================================================================');
  console.log(`  Total Checks Executed: ${passedTests + failedTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);

  if (failedTests > 0) {
    console.error('\n❌ NFR-14 TEST SUITE FAILED.\n');
    process.exit(1);
  } else {
    console.log('\n✨ ALL NFR-14 BRUTE FORCE PREVENTION TESTS PASSED!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
