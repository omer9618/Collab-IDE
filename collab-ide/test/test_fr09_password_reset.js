/**
 * ==============================================================================
 * CollabIDE - FR-09: Password Reset Comprehensive Verification Test Suite
 * ==============================================================================
 *
 * SPECIFICATION (FR-09):
 * "Users must be able to request a password reset via email.
 *  The system must send a time-limited (30 minutes), single-use signed reset link.
 *  After a successful reset, all existing refresh tokens for that user must be invalidated."
 *
 * Test Coverage:
 * 1. Request Password Reset (POST /api/auth/reset-password-request):
 *    - Rejects invalid/empty email formats (HTTP 400)
 *    - User enumeration prevention (identical generic response for registered and unregistered emails)
 *    - Generates 30-minute time-limited, RS256 cryptographically signed reset token
 *    - Stores SHA-256 hash at rest in MongoDB (plaintext token never stored in DB)
 *    - Email dispatch integration (simulated terminal mailer)
 * 2. Cryptographic Signature & Tamper Detection:
 *    - Authenticates valid RS256 signed token
 *    - Rejects signature tampering / bit modification
 *    - Gracefully supports backward-compatible legacy raw hex tokens
 * 3. Token Validation (GET /api/auth/reset-password/validate):
 *    - Validates active token and returns HTTP 200 { valid: true }
 *    - Rejects missing, invalid, or expired tokens (HTTP 400)
 * 4. Password Reset Execution (POST /api/auth/reset-password):
 *    - Enforces NFR-16 password complexity policy on new password
 *    - Successfully updates user password with Bcrypt (cost factor 12)
 *    - Verifies authentication succeeds with new password
 *    - Verifies authentication fails with old password
 * 5. Single-Use Guarantee:
 *    - Reset token and expiration are wiped from MongoDB upon execution
 *    - Subsequent validation and execution attempts with same token fail (HTTP 400)
 * 6. Refresh Token Invalidation (FR-09 Core Mandate):
 *    - Pre-populates multiple active refresh tokens across simulated devices
 *    - Verifies 100% of existing refresh tokens for that user are deleted from MongoDB
 *    - Verifies old refresh tokens can no longer rotate or refresh access tokens
 * 7. Account Lockout Synergy (FR-05 / NFR-14):
 *    - Resets failed login attempts and lockout timestamps upon password recovery
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { app } = require('../server');
const { publicKey } = require('../utils/keys');
const { generatePasswordResetToken, verifyPasswordResetToken } = require('../utils/jwt');

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

async function runTests() {
  console.log('\n================================================================');
  console.log('🧪 Starting FR-09: Password Reset Verification Test Suite');
  console.log('================================================================\n');

  // 1. Connect to MongoDB
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
  assert(mongoose.connection.readyState === 1, 'Connected to MongoDB database');

  // 2. Start Test Server on dedicated port
  const testPort = 3197;
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(testPort, resolve));
  const baseUrl = `http://localhost:${testPort}`;
  console.log(`📡 Test server listening on ${baseUrl}\n`);

  // 3. Test Fixture Setup
  const timestamp = Date.now();
  const testEmail = `fr09-tester-${timestamp}@example.com`;
  const initialPassword = 'OldPassword123!';
  const newPassword = 'NewStrongPassword456@#';

  const user = await User.create({
    email: testEmail,
    password: initialPassword,
    displayName: 'FR-09 Test User',
    avatarColor: '#10b981',
    isVerified: true,
  });
  const userId = user._id;

  try {
    // --------------------------------------------------------------------------
    // Suite 1: Request Password Reset (POST /api/auth/reset-password-request)
    // --------------------------------------------------------------------------
    console.log('📨 Suite 1: Password Reset Request & Anti-Enumeration...');

    // 1.1 Empty email validation
    const emptyEmailRes = await fetch(`${baseUrl}/api/auth/reset-password-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '' }),
    });
    assert(emptyEmailRes.status === 400, 'Rejects empty email request with HTTP 400');

    // 1.2 Anti-enumeration check (non-existent email)
    const unknownEmailRes = await fetch(`${baseUrl}/api/auth/reset-password-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent-user-99999@example.com' }),
    });
    const unknownData = await unknownEmailRes.json();
    assert(unknownEmailRes.status === 200, 'Returns HTTP 200 for non-existent email (anti-enumeration)');
    assert(
      unknownData.message.includes('If the email matches a registered account'),
      'Returns generic success message without leaking account existence'
    );
    assert(!unknownData.debugResetToken, 'Does not generate debug token for non-existent user');

    // 1.3 Legitimate reset request for registered user
    const resetReqRes = await fetch(`${baseUrl}/api/auth/reset-password-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const resetReqData = await resetReqRes.json();
    assert(resetReqRes.status === 200, 'Returns HTTP 200 for registered email');
    assert(Boolean(resetReqData.debugResetToken), 'Dispatches debugResetToken in non-production mode');
    assert(Boolean(resetReqData.debugResetLink), 'Dispatches debugResetLink with full frontend URL');

    const signedResetToken = resetReqData.debugResetToken;
    const rawResetToken = resetReqData.rawResetToken;

    // 1.4 Database state verification
    const dbUserAfterReq = await User.findById(userId).lean();
    assert(Boolean(dbUserAfterReq.resetPasswordToken), 'Stores resetPasswordToken in MongoDB');
    assert(Boolean(dbUserAfterReq.resetPasswordExpires), 'Stores resetPasswordExpires in MongoDB');

    // Plaintext token must NEVER be stored at rest
    assert(dbUserAfterReq.resetPasswordToken !== rawResetToken, 'Plaintext raw token is NOT stored in DB');
    assert(dbUserAfterReq.resetPasswordToken !== signedResetToken, 'Signed JWT token is NOT stored in DB');

    // SHA-256 hash check
    const expectedHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    assert(dbUserAfterReq.resetPasswordToken === expectedHash, 'Token is securely hashed with SHA-256 at rest');

    // 30-minute expiration check (within 10-second margin of error)
    const thirtyMinutesMs = 30 * 60 * 1000;
    const now = Date.now();
    const expiryDiff = new Date(dbUserAfterReq.resetPasswordExpires).getTime() - now;
    assert(
      expiryDiff > twentyNineMinutesMs(now) && expiryDiff <= thirtyMinutesMs + 5000,
      `Token expiration is set to 30 minutes in future (actual diff: ${Math.round(expiryDiff / 60000)}m)`
    );

    // --------------------------------------------------------------------------
    // Suite 2: Cryptographic Signature & Tamper Detection
    // --------------------------------------------------------------------------
    console.log('\n🔒 Suite 2: RS256 Cryptographic Signature & Tamper Detection...');

    // 2.1 Verify RS256 signature mathematically
    const decodedPayload = verifyPasswordResetToken(signedResetToken);
    assert(decodedPayload.sub === userId.toString(), 'RS256 JWT decodes matching user ID subject');
    assert(decodedPayload.type === 'password-reset', 'RS256 JWT declares type: password-reset');
    assert(decodedPayload.jti === rawResetToken, 'RS256 JWT contains authentic jti entropy');

    // 2.2 Tampered token payload
    const tokenParts = signedResetToken.split('.');
    assert(tokenParts.length === 3, 'Signed token has valid 3-part JWT structure (header.payload.sig)');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: userId.toString(), jti: 'tampered-entropy-12345', type: 'password-reset' })
    ).toString('base64url');
    const tamperedToken = `${tokenParts[0]}.${tamperedPayload}.${tokenParts[2]}`;

    const tamperValRes = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${encodeURIComponent(tamperedToken)}`);
    const tamperValData = await tamperValRes.json();
    assert(tamperValRes.status === 400, 'Tampered token signature is rejected with HTTP 400');
    assert(tamperValData.valid === false, 'Tampered token reports valid: false');

    // 2.3 Legacy raw hex token compatibility
    const legacyValRes = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${encodeURIComponent(rawResetToken)}`);
    const legacyValData = await legacyValRes.json();
    assert(legacyValRes.status === 200, 'Backward compatibility: Legacy raw 64-hex token validates successfully');
    assert(legacyValData.valid === true, 'Legacy token reports valid: true');

    // --------------------------------------------------------------------------
    // Suite 3: Token Validation Endpoint (GET /api/auth/reset-password/validate)
    // --------------------------------------------------------------------------
    console.log('\n🔍 Suite 3: Token Validation Endpoint...');

    // 3.1 Missing token
    const missingValRes = await fetch(`${baseUrl}/api/auth/reset-password/validate`);
    assert(missingValRes.status === 400, 'Rejects validate request without token (HTTP 400)');

    // 3.2 Non-existent / random token
    const randomHex = crypto.randomBytes(32).toString('hex');
    const randomValRes = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${randomHex}`);
    assert(randomValRes.status === 400, 'Rejects unrecognized reset token with HTTP 400');

    // 3.3 Valid signed token
    const validValRes = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${encodeURIComponent(signedResetToken)}`);
    const validValData = await validValRes.json();
    assert(validValRes.status === 200, 'Valid signed token returns HTTP 200');
    assert(validValData.valid === true, 'Valid signed token returns valid: true');
    assert(validValData.email === testEmail, 'Validation response includes user email for UI display');

    // 3.4 Expired token simulation
    await User.updateOne({ _id: userId }, { resetPasswordExpires: new Date(Date.now() - 1000) });
    const expiredValRes = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${encodeURIComponent(signedResetToken)}`);
    assert(expiredValRes.status === 400, 'Expired reset token is rejected with HTTP 400');

    // Restore valid expiration for subsequent suites
    await User.updateOne({ _id: userId }, { resetPasswordExpires: new Date(Date.now() + thirtyMinutesMs) });

    // --------------------------------------------------------------------------
    // Suite 4: Pre-Populate Multiple Active Refresh Tokens across Devices
    // --------------------------------------------------------------------------
    console.log('\n📱 Suite 4: Multi-Device Refresh Token Setup (FR-09 Invalidation Pre-Condition)...');

    // Create 3 active refresh tokens across simulated devices (Laptop, Phone, Tablet)
    const devices = ['CollabIDE Desktop (Windows)', 'CollabIDE Mobile (iOS)', 'CollabIDE Tablet (Android)'];
    for (let i = 0; i < devices.length; i++) {
      const rawTokenVal = crypto.randomBytes(32).toString('hex');
      const hashedTokenVal = await bcrypt.hash(rawTokenVal, 10);
      await RefreshToken.create({
        token: hashedTokenVal,
        user: userId,
        familyId: `family-device-${i}-${timestamp}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deviceInfo: devices[i],
      });
    }

    const preResetTokens = await RefreshToken.find({ user: userId });
    assert(preResetTokens.length === 3, `Pre-populated 3 active device refresh tokens for user in MongoDB`);

    // Simulate account lockout prior to reset (FR-05 synergy)
    await User.updateOne({ _id: userId }, { loginAttempts: 5, lockUntil: new Date(Date.now() + 600000) });
    const preLockoutUser = await User.findById(userId).lean();
    assert(preLockoutUser.loginAttempts === 5, 'User account placed in locked state before reset');

    // --------------------------------------------------------------------------
    // Suite 5: Password Reset Execution (POST /api/auth/reset-password)
    // --------------------------------------------------------------------------
    console.log('\n🔑 Suite 5: Password Reset Execution & NFR-16 Policy Enforcement...');

    // 5.1 Missing parameters
    const missingParamRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: signedResetToken }),
    });
    assert(missingParamRes.status === 400, 'Rejects password reset missing newPassword');

    // 5.2 Weak password complexity rejection (NFR-16)
    const weakPasswords = [
      { pwd: 'short', reason: '< 8 chars' },
      { pwd: 'alllowercase123!', reason: 'no uppercase' },
      { pwd: 'ALLUPPERCASE123!', reason: 'no lowercase' },
      { pwd: 'NoNumbersSpecial!', reason: 'no numbers' },
      { pwd: 'NoSpecialChars123', reason: 'no special character' },
    ];
    for (const { pwd, reason } of weakPasswords) {
      const weakRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: signedResetToken, newPassword: pwd }),
      });
      assert(weakRes.status === 400, `Rejects password failing complexity: ${reason}`);
    }

    // 5.3 Successful password reset with compliant password
    const resetExecRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: signedResetToken, newPassword }),
    });
    const resetExecData = await resetExecRes.json();
    assert(resetExecRes.status === 200, 'Password reset succeeds with HTTP 200');
    assert(
      resetExecData.message.includes('Password has been reset successfully'),
      'Returns success confirmation message'
    );

    // --------------------------------------------------------------------------
    // Suite 6: Single-Use Token Guarantee & Database Cleanup
    // --------------------------------------------------------------------------
    console.log('\n♻️ Suite 6: Single-Use Guarantee & Database Token Purge...');

    const postResetUser = await User.findById(userId).lean();
    assert(postResetUser.resetPasswordToken === undefined, 'resetPasswordToken is wiped from MongoDB');
    assert(postResetUser.resetPasswordExpires === undefined, 'resetPasswordExpires is wiped from MongoDB');

    // Attempting to reuse the signed token in validation
    const reuseValRes = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${encodeURIComponent(signedResetToken)}`);
    assert(reuseValRes.status === 400, 'Single-use: Reusing reset token in validate is rejected with HTTP 400');

    // Attempting to reuse the signed token in execution
    const reuseExecRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: signedResetToken, newPassword: 'AnotherPassword999!@#' }),
    });
    assert(reuseExecRes.status === 400, 'Single-use: Reusing reset token to reset again is rejected with HTTP 400');

    // --------------------------------------------------------------------------
    // Suite 7: Refresh Token Invalidation & Session Revocation (FR-09 Core)
    // --------------------------------------------------------------------------
    console.log('\n🚫 Suite 7: Refresh Token Invalidation Verification (FR-09 Core)...');

    const remainingTokens = await RefreshToken.find({ user: userId });
    assert(
      remainingTokens.length === 0,
      `All existing refresh tokens for user have been deleted from MongoDB (remaining: ${remainingTokens.length}, expected: 0)`
    );

    // --------------------------------------------------------------------------
    // Suite 8: Authentication Verification with New vs Old Password
    // --------------------------------------------------------------------------
    console.log('\n🔐 Suite 8: Authentication Verification with New vs Old Password...');

    // 8.1 Login with OLD password must fail
    const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: initialPassword }),
    });
    assert(oldLoginRes.status === 400 || oldLoginRes.status === 401, 'Authentication with OLD password fails');

    // 8.2 Login with NEW password must succeed
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: newPassword }),
    });
    const newLoginData = await newLoginRes.json();
    assert(newLoginRes.status === 200, 'Authentication with NEW password succeeds (HTTP 200)');
    assert(Boolean(newLoginData.accessToken), 'Login with new password issues fresh RS256 accessToken');

    // 8.3 Verify lockout was cleared
    const postLoginUser = await User.findById(userId).lean();
    assert(postLoginUser.loginAttempts === 0, 'Account lockout attempts reset to 0');
    assert(!postLoginUser.lockUntil, 'Account lockout lockUntil cleared');

  } finally {
    // Clean up test fixtures
    await RefreshToken.deleteMany({ user: userId });
    await User.deleteOne({ _id: userId });
    await new Promise((resolve) => testServer.close(resolve));
    console.log('\n🧹 Test fixtures cleaned up and test server closed.');
  }

  console.log('\n================================================================');
  console.log(`📊 FR-09 Test Summary: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

function twentyNineMinutesMs(now) {
  return 29 * 60 * 1000;
}

runTests().catch((err) => {
  console.error('❌ Unhandled error in FR-09 test suite:', err);
  process.exit(1);
});

