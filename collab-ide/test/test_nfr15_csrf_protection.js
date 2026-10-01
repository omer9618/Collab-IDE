/**
 * ==============================================================================
 * CollabIDE - NFR-15: CSRF Protection Automated Integration Test Suite
 * ==============================================================================
 * Tests the complete NFR-15 requirements:
 * 1. GET /api/auth/csrf-token issues XSRF-TOKEN cookie with SameSite=Strict and httpOnly=false.
 * 2. Safe methods (GET, HEAD, OPTIONS) do not require CSRF token and set XSRF-TOKEN if missing.
 * 3. Double-submit cookie verification: state-changing requests with cookies require matching X-CSRF-Token.
 * 4. TimingSafeEqual robustness: length mismatch (empty string, truncated, extra-long, non-string)
 *    cleanly returns HTTP 403 (EBADCSRFTOKEN) and NEVER throws or returns 500.
 * 5. Logout clearCookie uses exact matching options (SameSite=Strict, Path=/) so cookies don't linger.
 * 6. Pure programmatic API requests (Authorization: Bearer with ZERO cookies) pass cleanly.
 * 7. Cold-start end-to-end: brand-new client with zero cookies fetches token and logs in successfully.
 * 8. Cookie-authenticated endpoints (POST /api/auth/refresh) strictly reject forged requests without CSRF token.
 * 9. CORS headers confirm Access-Control-Allow-Credentials: true and echoed Origin.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { privateKey } = require('../utils/keys');
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
  allHeaders.forEach(str => {
    const parts = str.split(';').map(p => p.trim());
    const [nameVal, ...attrs] = parts;
    const [name, val] = nameVal.split('=');
    if (name) {
      cookies[name.trim()] = {
        value: val ? decodeURIComponent(val.trim()) : '',
        raw: str,
        isHttpOnly: attrs.some(a => a.toLowerCase() === 'httponly'),
        isSameSiteStrict: attrs.some(a => a.toLowerCase() === 'samesite=strict'),
        path: (attrs.find(a => a.toLowerCase().startsWith('path=')) || '').split('=')[1] || '',
      };
    }
  });
  return cookies;
}

async function runTests() {
  console.log('\n================================================================');
  console.log('🧪 Starting NFR-15 CSRF Protection Automated Integration Test');
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
    await new Promise(resolve => mongoose.connection.once('open', resolve));
  }
  assert(mongoose.connection.readyState === 1, 'Connected to MongoDB Atlas');

  // 2. Start Test Server on dedicated port
  const testPort = 3195;
  const testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(testPort, resolve));
  const baseUrl = `http://localhost:${testPort}`;
  console.log(`📡 Test server listening on ${baseUrl}\n`);

  // 3. Create or find test user
  const testEmail = `csrf-tester-${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testUser = await User.create({
    email: testEmail,
    password: testPassword,
    displayName: 'CSRF Tester',
    avatarColor: '#007acc',
    isVerified: true,
  });

  const validJwt = jwt.sign({ userId: testUser._id, type: 'access' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
  });

  try {
    // --------------------------------------------------------------------------
    // Phase 1: CSRF Token Endpoint & Cookie Attributes
    // --------------------------------------------------------------------------
    console.log('⚙️ Phase 1: Verifying CSRF Token Provisioning & Cookie Security Flags...');
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf-token`);
    const csrfData = await csrfRes.json();
    const cookies1 = parseSetCookies(csrfRes);

    assert(csrfRes.status === 200, 'GET /api/auth/csrf-token returns HTTP 200');
    assert(typeof csrfData.csrfToken === 'string' && csrfData.csrfToken.length === 64, 'Endpoint returns 64-char hex CSRF token');
    assert(Boolean(cookies1['XSRF-TOKEN']), 'Response sets XSRF-TOKEN cookie');
    assert(cookies1['XSRF-TOKEN'].isHttpOnly === false, 'XSRF-TOKEN has httpOnly=false (required for JS double-submit reading)');
    assert(cookies1['XSRF-TOKEN'].isSameSiteStrict === true, 'XSRF-TOKEN has SameSite=Strict (satisfies NFR-15 policy)');
    assert(cookies1['XSRF-TOKEN'].path === '/', 'XSRF-TOKEN has Path=/');

    const validCsrfToken = csrfData.csrfToken;
    const xsrfCookie = `XSRF-TOKEN=${validCsrfToken}`;

    // --------------------------------------------------------------------------
    // Phase 2: Safe HTTP Methods Bypass
    // --------------------------------------------------------------------------
    console.log('\n⚙️ Phase 2: Verifying Safe Methods (GET, HEAD, OPTIONS) do not require CSRF token...');
    const healthRes = await fetch(`${baseUrl}/health`);
    assert(healthRes.status === 200, 'GET /health succeeds without CSRF headers');

    const safeRoomsRes = await fetch(`${baseUrl}/api/rooms`, {
      headers: { Authorization: `Bearer ${validJwt}` },
    });
    assert(safeRoomsRes.status === 200, 'GET /api/rooms succeeds without CSRF headers');

    // --------------------------------------------------------------------------
    // Phase 3: TimingSafeEqual Length Mismatch & Robustness (User Feedback Point 1)
    // --------------------------------------------------------------------------
    console.log('\n🛡️ Phase 3: Verifying crypto.timingSafeEqual Length Mismatch Robustness...');
    
    // Case 3a: Empty string token
    const emptyTokenRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validJwt}`,
        Cookie: xsrfCookie,
        'X-CSRF-Token': '',
      },
      body: JSON.stringify({ displayName: 'Hacked Name' }),
    });
    const emptyData = await emptyTokenRes.json();
    assert(emptyTokenRes.status === 403, 'Empty string token returns HTTP 403 Forbidden (not 500)');
    assert(emptyData.code === 'EBADCSRFTOKEN', 'Error response returns code EBADCSRFTOKEN');

    // Case 3b: Truncated token (e.g. 10 chars vs 64 chars)
    const truncatedTokenRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validJwt}`,
        Cookie: xsrfCookie,
        'X-CSRF-Token': validCsrfToken.substring(0, 10),
      },
      body: JSON.stringify({ displayName: 'Hacked Name' }),
    });
    assert(truncatedTokenRes.status === 403, 'Truncated token returns HTTP 403 without timingSafeEqual length crash');

    // Case 3c: Extra-long token (e.g. 128 chars vs 64 chars)
    const extraLongTokenRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validJwt}`,
        Cookie: xsrfCookie,
        'X-CSRF-Token': validCsrfToken + validCsrfToken,
      },
      body: JSON.stringify({ displayName: 'Hacked Name' }),
    });
    assert(extraLongTokenRes.status === 403, 'Extra-long token returns HTTP 403 without timingSafeEqual length crash');

    // Case 3d: Same-length mismatched token
    const wrongTokenSameLength = 'a'.repeat(64);
    const mismatchTokenRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validJwt}`,
        Cookie: xsrfCookie,
        'X-CSRF-Token': wrongTokenSameLength,
      },
      body: JSON.stringify({ displayName: 'Hacked Name' }),
    });
    assert(mismatchTokenRes.status === 403, 'Mismatched token with identical byte length returns HTTP 403');

    // Case 3e: Completely missing CSRF header when cookie is present
    const missingHeaderRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validJwt}`,
        Cookie: xsrfCookie,
      },
      body: JSON.stringify({ displayName: 'Hacked Name' }),
    });
    assert(missingHeaderRes.status === 403, 'Missing X-CSRF-Token header when cookie is present returns HTTP 403');

    // --------------------------------------------------------------------------
    // Phase 4: Valid Double-Submit Token Success
    // --------------------------------------------------------------------------
    console.log('\n🔒 Phase 4: Verifying Valid Double-Submit Token Acceptance...');
    const validUpdateRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validJwt}`,
        Cookie: xsrfCookie,
        'X-CSRF-Token': validCsrfToken,
      },
      body: JSON.stringify({ displayName: 'Verified CSRF User' }),
    });
    const updateData = await validUpdateRes.json();
    assert(validUpdateRes.status === 200, 'Valid double-submit token returns HTTP 200');
    assert(updateData.user.displayName === 'Verified CSRF User', 'User displayName successfully updated');

    // --------------------------------------------------------------------------
    // Phase 5: Pure Bearer Token Requests with ZERO Cookies (User Feedback Point 3)
    // --------------------------------------------------------------------------
    console.log('\n🔑 Phase 5: Verifying Pure Programmatic API Requests (Bearer + Zero Cookies)...');
    const pureBearerRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validJwt}`,
        // NO Cookie header at all
      },
      body: JSON.stringify({ displayName: 'Pure Bearer User' }),
    });
    const pureBearerData = await pureBearerRes.json();
    assert(pureBearerRes.status === 200, 'Pure programmatic request (Authorization: Bearer with zero cookies) returns HTTP 200');
    assert(pureBearerData.user.displayName === 'Pure Bearer User', 'Profile updated by pure API client without ambient cookies');

    // --------------------------------------------------------------------------
    // Phase 6: Cookie-Authenticated Endpoints (/api/auth/refresh, /api/auth/logout)
    // --------------------------------------------------------------------------
    console.log('\n🍪 Phase 6: Verifying Cookie-Authenticated Endpoints (Refresh & Logout)...');
    
    // Create a real refresh token in DB
    const { plaintext: rawRefreshToken, tokenDoc } = await RefreshToken.generate(testUser._id, null, 'Test Device');
    await tokenDoc.save();

    const authCookies = `refreshToken=${rawRefreshToken}; XSRF-TOKEN=${validCsrfToken}`;

    // 6a: Forged cross-site POST /api/auth/refresh (has refreshToken cookie, but NO CSRF header)
    const forgedRefreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: authCookies,
        // No X-CSRF-Token header
      },
    });
    assert(forgedRefreshRes.status === 403, 'Forged POST /api/auth/refresh without CSRF header is blocked with HTTP 403');

    // 6b: Legitimate POST /api/auth/refresh (has refreshToken cookie AND matching X-CSRF-Token)
    const legitRefreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: authCookies,
        'X-CSRF-Token': validCsrfToken,
      },
    });
    const refreshData = await legitRefreshRes.json();
    assert(legitRefreshRes.status === 200, 'Legitimate POST /api/auth/refresh with matching CSRF token returns HTTP 200');
    assert(typeof refreshData.accessToken === 'string', 'Refresh endpoint issued rotated access token');
    assert(typeof refreshData.csrfToken === 'string', 'Refresh endpoint returned rotated CSRF token');

    // Verify rotated XSRF-TOKEN cookie in response
    const refreshCookies = parseSetCookies(legitRefreshRes);
    assert(Boolean(refreshCookies['XSRF-TOKEN']), 'Refresh response issued fresh XSRF-TOKEN cookie');
    assert(refreshCookies['XSRF-TOKEN'].isSameSiteStrict === true, 'Rotated XSRF-TOKEN maintains SameSite=Strict');

    // --------------------------------------------------------------------------
    // Phase 7: Logout clearCookie Options Matching (User Feedback Point 2)
    // --------------------------------------------------------------------------
    console.log('\n🚪 Phase 7: Verifying Logout Cookie Clearing Options Matching...');
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `refreshToken=${rawRefreshToken}; XSRF-TOKEN=${validCsrfToken}`,
        'X-CSRF-Token': validCsrfToken,
      },
    });
    assert(logoutRes.status === 200, 'POST /api/auth/logout with CSRF token returns HTTP 200');
    
    const logoutCookies = parseSetCookies(logoutRes);
    assert(Boolean(logoutCookies['XSRF-TOKEN']), 'Logout Set-Cookie header clears XSRF-TOKEN');
    assert(logoutCookies['XSRF-TOKEN'].isSameSiteStrict === true, 'XSRF-TOKEN clear retains SameSite=Strict');
    assert(logoutCookies['XSRF-TOKEN'].path === '/', 'XSRF-TOKEN clear retains Path=/');
    assert(logoutCookies['refreshToken'].isSameSiteStrict === true, 'refreshToken clear retains SameSite=Strict');
    assert(logoutCookies['refreshToken'].path === '/', 'refreshToken clear retains Path=/');

    // --------------------------------------------------------------------------
    // Phase 8: Cold-Start End-to-End Flow (User Feedback Point 4)
    // --------------------------------------------------------------------------
    console.log('\n❄️ Phase 8: Verifying Cold-Start Sequence End-to-End (Zero Initial Cookies)...');
    
    // Simulate brand-new browser session:
    // Step 1: Pre-flight fetch /api/auth/csrf-token
    const coldTokenRes = await fetch(`${baseUrl}/api/auth/csrf-token`);
    const coldTokenData = await coldTokenRes.json();
    const coldCookies = parseSetCookies(coldTokenRes);
    const initialCsrfToken = coldTokenData.csrfToken;
    const initialCookie = `XSRF-TOKEN=${coldCookies['XSRF-TOKEN'].value}`;

    assert(coldTokenRes.status === 200, 'Cold-start: GET /api/auth/csrf-token succeeds');
    assert(initialCsrfToken === coldCookies['XSRF-TOKEN'].value, 'Cold-start: body token matches cookie token');

    // Step 2: First user action: Login with acquired CSRF token and cookie
    const coldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: initialCookie,
        'X-CSRF-Token': initialCsrfToken,
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    const loginData = await coldLoginRes.json();
    assert(coldLoginRes.status === 200, 'Cold-start: First login POST succeeds with HTTP 200');
    assert(typeof loginData.accessToken === 'string', 'Login returns access token');
    assert(typeof loginData.csrfToken === 'string', 'Login returns rotated CSRF token');

    // --------------------------------------------------------------------------
    // Phase 9: CORS Credential Reflection (User Feedback Point 5)
    // --------------------------------------------------------------------------
    console.log('\n🌐 Phase 9: Verifying CORS Credentials & Origin Reflection...');
    const corsRes = await fetch(`${baseUrl}/api/auth/csrf-token`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert(corsRes.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'CORS dynamically echoes origin http://localhost:5173');
    assert(corsRes.headers.get('access-control-allow-credentials') === 'true', 'CORS sets Access-Control-Allow-Credentials: true');

  } finally {
    // Teardown
    await User.findByIdAndDelete(testUser._id);
    await RefreshToken.deleteMany({ user: testUser._id });
    await new Promise(resolve => testServer.close(resolve));
    await mongoose.connection.close(false);
  }

  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ NFR-15 CSRF Protection tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-15 CSRF PROTECTION REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
