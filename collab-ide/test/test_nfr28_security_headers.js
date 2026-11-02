const http = require('http');
const assert = require('assert');

async function testNFR28() {
  console.log('\n--- 🚀 Starting NFR-28: Security Headers Test ---\n');
  
  let passCount = 0;
  let failCount = 0;

  function runAssert(condition, message) {
    try {
      assert(condition, message);
      console.log(`✅ PASS: ${message}`);
      passCount++;
    } catch (err) {
      console.error(`❌ FAIL: ${message} (Expected truthy, got ${condition})`);
      failCount++;
    }
  }

  // Phase 1: Check HTTP Headers on a standard route
  console.log('\n[Phase 1] Fetching root endpoint to verify security headers...');
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/',
    method: 'GET'
  };

  await new Promise((resolve) => {
    const req = http.request(options, (res) => {
      console.log(`\nResponse Status: ${res.statusCode}`);
      const headers = res.headers;

      // Ensure helmet is applying the security headers
      runAssert(
        headers['strict-transport-security'] !== undefined,
        'Strict-Transport-Security header should be present'
      );
      
      runAssert(
        headers['x-content-type-options'] === 'nosniff',
        'X-Content-Type-Options should be "nosniff"'
      );
      
      runAssert(
        headers['x-frame-options'] === 'DENY',
        'X-Frame-Options should be "DENY"'
      );
      
      runAssert(
        headers['referrer-policy'] === 'no-referrer',
        'Referrer-Policy should be "no-referrer"'
      );
      
      runAssert(
        headers['content-security-policy'] !== undefined,
        'Content-Security-Policy header should be present'
      );

      resolve();
    });

    req.on('error', (e) => {
      console.error(`Problem with request: ${e.message}`);
      resolve();
    });

    req.end();
  });

  console.log('\n----------------------------------------');
  console.log(`🎯 Test Summary: ${passCount} Passed | ${failCount} Failed`);
  console.log('----------------------------------------\n');
  
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

testNFR28();
