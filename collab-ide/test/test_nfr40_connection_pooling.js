/**
 * ==============================================================================
 * CollabIDE - NFR-40 Database Connection Pooling Automated Test Suite
 * ==============================================================================
 * Tests the complete NFR-40 requirements:
 * 1. Default Mongoose connection pool configuration (min: 5, max: 20, idle: 30000ms).
 * 2. Environment variable tunability without code changes (MONGO_* and DB_* fallbacks).
 * 3. Configuration source tracing and fail-fast startup guard (min <= max).
 * 4. Real CMAP (Connection Pool Monitoring) driver event verification:
 *    - Total connections strictly capped at maxPoolSize under high concurrent load.
 *    - Backpressure / checkout queuing operates cleanly without pool exhaustion.
 * 5. NFR-38 Graceful Shutdown lifecycle singleton compatibility:
 *    - mongoose.connection.close(false) terminates the exact pooled singleton.
 * 6. Sanitized GET /health inspection.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { resolvePoolConfig, connectDB } = require('../config/db');
const User = require('../models/User');

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
  console.log('🧪 Starting NFR-40 Database Connection Pooling Automated Test');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI is not set in collab-ide/.env');
    process.exit(1);
  }

  // ----------------------------------------------------------------------------
  // Phase 1: Environment Variable Resolution, Precedence, and Fail-Fast Validation
  // ----------------------------------------------------------------------------
  console.log('⚙️ Phase 1: Verifying Configuration Resolution & Fail-Fast Validation...');

  // 1.1 Default resolution
  const defaultConfig = resolvePoolConfig({});
  assert(defaultConfig.minPoolSize === 5, 'Default minPoolSize is 5');
  assert(defaultConfig.maxPoolSize === 20, 'Default maxPoolSize is 20');
  assert(defaultConfig.maxIdleTimeMS === 30000, 'Default maxIdleTimeMS is 30,000ms (30 seconds)');
  assert(defaultConfig.sources.minPoolSize === 'default', 'minPoolSize source is "default"');
  assert(defaultConfig.sources.maxPoolSize === 'default', 'maxPoolSize source is "default"');

  // 1.2 Tunability via MONGO_* variables
  const tunedConfig = resolvePoolConfig({
    MONGO_MIN_POOL_SIZE: '10',
    MONGO_MAX_POOL_SIZE: '50',
    MONGO_MAX_IDLE_TIME_MS: '15000',
  });
  assert(tunedConfig.minPoolSize === 10, 'Tuned minPoolSize resolved to 10');
  assert(tunedConfig.maxPoolSize === 50, 'Tuned maxPoolSize resolved to 50');
  assert(tunedConfig.maxIdleTimeMS === 15000, 'Tuned maxIdleTimeMS resolved to 15,000ms');
  assert(tunedConfig.sources.minPoolSize === 'MONGO_MIN_POOL_SIZE', 'minPoolSize source is MONGO_MIN_POOL_SIZE');
  assert(tunedConfig.sources.maxPoolSize === 'MONGO_MAX_POOL_SIZE', 'maxPoolSize source is MONGO_MAX_POOL_SIZE');

  // 1.3 Precedence: MONGO_* overrides DB_*
  const precedenceConfig = resolvePoolConfig({
    MONGO_MAX_POOL_SIZE: '45',
    DB_MAX_POOL_SIZE: '30',
    DB_MIN_POOL_SIZE: '8',
  });
  assert(precedenceConfig.maxPoolSize === 45, 'MONGO_MAX_POOL_SIZE (45) takes precedence over DB_MAX_POOL_SIZE (30)');
  assert(precedenceConfig.minPoolSize === 8, 'DB_MIN_POOL_SIZE (8) is used when MONGO_MIN_POOL_SIZE is absent');

  // 1.4 Fail-Fast: minPoolSize > maxPoolSize guard
  let minGreaterThanMaxCaught = false;
  try {
    resolvePoolConfig({
      MONGO_MIN_POOL_SIZE: '25',
      MONGO_MAX_POOL_SIZE: '20',
    });
  } catch (err) {
    minGreaterThanMaxCaught = err.message.includes('cannot exceed maxPoolSize');
  }
  assert(minGreaterThanMaxCaught, 'Fail-fast guard rejects minPoolSize > maxPoolSize with an actionable error');

  // 1.5 Fail-Fast: Negative and non-integer validations
  let invalidMinCaught = false;
  try {
    resolvePoolConfig({ MONGO_MIN_POOL_SIZE: '-1' });
  } catch (err) {
    invalidMinCaught = err.message.includes('non-negative integer');
  }
  assert(invalidMinCaught, 'Fail-fast guard rejects negative minPoolSize');

  let invalidMaxCaught = false;
  try {
    resolvePoolConfig({ MONGO_MAX_POOL_SIZE: '0' });
  } catch (err) {
    invalidMaxCaught = err.message.includes('integer >= 1');
  }
  assert(invalidMaxCaught, 'Fail-fast guard rejects maxPoolSize < 1');

  // ----------------------------------------------------------------------------
  // Phase 2: Live Mongoose Singleton Connection & Driver Options Verification
  // ----------------------------------------------------------------------------
  console.log('\n🔌 Phase 2: Connecting Mongoose Default Singleton & Introspecting Driver Options...');

  // Disconnect if previously open
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
  }

  // Connect via config/db.js
  const conn = await connectDB();
  assert(mongoose.connection.readyState === 1, 'Mongoose default singleton is connected (readyState === 1)');
  assert(conn === mongoose, 'connectDB attaches directly to default Mongoose singleton (NFR-38 guarantee)');

  const client = mongoose.connection.getClient();
  assert(client !== null, 'MongoDB driver MongoClient client instance retrieved');
  assert(client.options.minPoolSize === 5, `Driver options confirm minPoolSize === 5 (Actual: ${client.options.minPoolSize})`);
  assert(client.options.maxPoolSize === 20, `Driver options confirm maxPoolSize === 20 (Actual: ${client.options.maxPoolSize})`);
  assert(client.options.maxIdleTimeMS === 30000, `Driver options confirm maxIdleTimeMS === 30000 (Actual: ${client.options.maxIdleTimeMS})`);

  // ----------------------------------------------------------------------------
  // Phase 3: Real CMAP (Connection Pool Monitoring) Driver Event Instrumentation
  // ----------------------------------------------------------------------------
  console.log('\n📊 Phase 3: Testing Real Connection Pool Capping & Backpressure via CMAP Events...');

  // Disconnect default connection to spin up an instrumented pool with strict cap
  await mongoose.connection.close(false);

  const TEST_MIN_POOL = 2;
  const TEST_MAX_POOL = 5;
  const testEnv = {
    ...process.env,
    MONGO_MIN_POOL_SIZE: TEST_MIN_POOL.toString(),
    MONGO_MAX_POOL_SIZE: TEST_MAX_POOL.toString(),
    MONGO_MAX_IDLE_TIME_MS: '30000',
  };

  // Connect singleton with test sizing
  await connectDB(testEnv);
  const instrumentedClient = mongoose.connection.getClient();

  let createdConnections = 0;
  let closedConnections = 0;
  let checkOutCount = 0;
  let checkInCount = 0;

  instrumentedClient.on('connectionCreated', () => {
    createdConnections++;
  });
  instrumentedClient.on('connectionClosed', () => {
    closedConnections++;
  });
  instrumentedClient.on('connectionCheckedOut', () => {
    checkOutCount++;
  });
  instrumentedClient.on('connectionCheckedIn', () => {
    checkInCount++;
  });

  // Warm-up query to establish initial connections
  await User.findOne().lean();
  await sleep(300);

  // Fire a burst of 30 concurrent database queries against the max:5 connection pool
  console.log(`  ⚡ Executing burst of 30 concurrent queries against maxPoolSize=${TEST_MAX_POOL} pool...`);
  const burstQueries = Array.from({ length: 30 }, (_, i) =>
    User.findOne().select('_id').lean()
  );

  const results = await Promise.all(burstQueries);
  await sleep(500);

  assert(results.length === 30, 'All 30 concurrent database queries resolved successfully');
  assert(
    createdConnections <= TEST_MAX_POOL,
    `Total created connections (${createdConnections}) strictly capped at maxPoolSize (${TEST_MAX_POOL})`
  );
  assert(
    checkOutCount >= 30,
    `Connection checkout events recorded (${checkOutCount}) demonstrating active pool reuse`
  );
  assert(
    checkInCount === checkOutCount,
    `All checked-out connections checked back into the pool (${checkInCount}/${checkOutCount}) with zero leaks`
  );

  // ----------------------------------------------------------------------------
  // Phase 4: NFR-38 Lifecycle Teardown Compatibility Verification
  // ----------------------------------------------------------------------------
  console.log('\n🛑 Phase 4: Verifying NFR-38 Graceful Shutdown Teardown Compatibility...');

  // NFR-38 graceful shutdown calls mongoose.connection.close(false)
  await mongoose.connection.close(false);
  assert(mongoose.connection.readyState === 0, 'mongoose.connection.close(false) successfully disconnected singleton pool (readyState === 0)');

  // ----------------------------------------------------------------------------
  // Phase 5: Health Check Endpoint Introspection
  // ----------------------------------------------------------------------------
  console.log('\n🏥 Phase 5: Verifying Sanitized GET /health Endpoint...');

  // Reconnect standard pool and mount app for health check
  await connectDB();
  const { app } = require('../server');
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    assert(healthRes.status === 200, 'GET /health returns HTTP 200');

    const healthData = await healthRes.json();
    assert(healthData.database !== undefined, 'Health check response includes "database" object');
    assert(healthData.database.connected === true, 'database.connected reports true');
    assert(healthData.database.minPoolSize === 5, `database.minPoolSize reports 5 (Actual: ${healthData.database.minPoolSize})`);
    assert(healthData.database.maxPoolSize === 20, `database.maxPoolSize reports 20 (Actual: ${healthData.database.maxPoolSize})`);
    assert(healthData.database.maxIdleTimeMS === 30000, `database.maxIdleTimeMS reports 30,000ms`);

    const rawPayload = JSON.stringify(healthData);
    assert(!rawPayload.includes('mongodb://'), 'Health check payload does not expose MongoDB URI');
    assert(!rawPayload.includes('authSource'), 'Health check payload does not expose auth credentials');
  } finally {
    server.close();
    await mongoose.connection.close(false);
  }

  // ----------------------------------------------------------------------------
  // Summary
  // ----------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ Some tests failed.');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-40 CONNECTION POOLING REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTest().catch((err) => {
  console.error('❌ Unhandled test error:', err);
  process.exit(1);
});
