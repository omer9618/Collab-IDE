/**
 * ==============================================================================
 * CollabIDE - FR-26 Font Size Adjustment Automated Integration Test Suite
 * ==============================================================================
 * Tests the complete FR-26 requirements:
 * 1. User defaults to fontSize: 14 in preferences.
 * 2. PUT /api/auth/profile updates preferences.fontSize successfully.
 * 3. GET /api/auth/me returns persisted preferences.
 * 4. MongoDB document directly contains persisted preferences.
 * 5. Boundary validation rejects font sizes < 10 or > 32 or invalid formats.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { privateKey } = require('../utils/keys');
const User = require('../models/User');
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

async function runTest() {
  console.log('================================================================');
  console.log('🧪 Starting FR-26 Font Size Adjustment Automated Integration Test');
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

  // 2. Find or create test user
  let testUser = await User.findOne({ email: 'fontsize-tester@example.com' });
  if (testUser) {
    testUser.preferences = { fontSize: 14 };
    await testUser.save();
  } else {
    testUser = await User.create({
      displayName: 'FontSize Tester',
      email: 'fontsize-tester@example.com',
      password: 'HashedPassword123!',
      isVerified: true,
      preferences: { fontSize: 14 }
    });
  }

  const token = jwt.sign(
    { userId: testUser._id, email: testUser.email },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1h' }
  );

  // 3. Start local server for HTTP testing
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // --------------------------------------------------------------------------
    // Test 1: GET /api/auth/me returns default preferences
    // --------------------------------------------------------------------------
    console.log('\n🔍 Test 1: Fetching initial user profile...');
    const getRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const getData = await getRes.json();
    assert(getRes.status === 200, 'GET /api/auth/me returns HTTP 200');
    assert(getData.user.preferences !== undefined, 'User object includes preferences');
    assert(getData.user.preferences.fontSize === 14, `Default font size is 14 (Actual: ${getData.user.preferences?.fontSize})`);

    // --------------------------------------------------------------------------
    // Test 2: PUT /api/auth/profile updates font size to 18
    // --------------------------------------------------------------------------
    console.log('\n📝 Test 2: Updating font size to 18px...');
    const updateRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        preferences: { fontSize: 18 }
      })
    });
    const updateData = await updateRes.json();
    assert(updateRes.status === 200, 'PUT /api/auth/profile returns HTTP 200 on valid font size');
    assert(updateData.user.preferences.fontSize === 18, `Response confirms fontSize updated to 18 (Actual: ${updateData.user.preferences?.fontSize})`);

    // --------------------------------------------------------------------------
    // Test 3: GET /api/auth/me returns persisted font size
    // --------------------------------------------------------------------------
    console.log('\n🔄 Test 3: Verifying persistence via GET /api/auth/me...');
    const verifyGetRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const verifyGetData = await verifyGetRes.json();
    assert(verifyGetData.user.preferences.fontSize === 18, 'GET /api/auth/me returns updated font size 18');

    // --------------------------------------------------------------------------
    // Test 4: Verify directly in MongoDB Atlas
    // --------------------------------------------------------------------------
    console.log('\n💾 Test 4: Verifying direct database persistence in MongoDB Atlas...');
    const dbUser = await User.findById(testUser._id);
    assert(dbUser.preferences.fontSize === 18, 'MongoDB document stores preferences.fontSize === 18');

    // --------------------------------------------------------------------------
    // Test 5: Boundary Validation - Lower limit (< 10)
    // --------------------------------------------------------------------------
    console.log('\n🚫 Test 5: Testing lower boundary rejection (fontSize: 8 < 10)...');
    const lowerRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        preferences: { fontSize: 8 }
      })
    });
    assert(lowerRes.status === 400, `Rejected fontSize: 8 with HTTP 400 (Actual: ${lowerRes.status})`);

    // --------------------------------------------------------------------------
    // Test 6: Boundary Validation - Upper limit (> 32)
    // --------------------------------------------------------------------------
    console.log('\n🚫 Test 6: Testing upper boundary rejection (fontSize: 36 > 32)...');
    const upperRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        preferences: { fontSize: 36 }
      })
    });
    assert(upperRes.status === 400, `Rejected fontSize: 36 with HTTP 400 (Actual: ${upperRes.status})`);

    // --------------------------------------------------------------------------
    // Test 7: Non-integer / non-numeric validation
    // --------------------------------------------------------------------------
    console.log('\n🚫 Test 7: Testing invalid format rejection (fontSize: "large")...');
    const invalidRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        preferences: { fontSize: 'large' }
      })
    });
    assert(invalidRes.status === 400, `Rejected non-numeric fontSize with HTTP 400 (Actual: ${invalidRes.status})`);

    // --------------------------------------------------------------------------
    // Test 8: Reset to 14
    // --------------------------------------------------------------------------
    console.log('\n🔄 Test 8: Resetting font size to default 14...');
    const resetRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        preferences: { fontSize: 14 }
      })
    });
    const resetData = await resetRes.json();
    assert(resetData.user.preferences.fontSize === 14, 'Successfully reset font size to 14');

  } finally {
    // Cleanup
    server.close();
    await User.deleteOne({ email: 'fontsize-tester@example.com' });
    await mongoose.connection.close();
  }

  // Summary
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL FR-26 BACKEND REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTest().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
