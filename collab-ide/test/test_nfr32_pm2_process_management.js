/**
 * @file test/test_nfr32_pm2_process_management.js
 * @description Comprehensive Automated Test Suite for NFR-32: Process Management with PM2.
 * 
 * Tests the complete NFR-32 requirements across 6 rigorous suites:
 * - Suite 1: Static Configuration Invariants & Schema Verification (ecosystem.config.js, NFR-32/38/49)
 * - Suite 2: Application Log Rotation Engine & 14-Day Retention Logic (utils/logRotator.js, zero dual-rotator race)
 * - Suite 3: Memory Limit Calculation & Unit Conversions (512MB = 536,870,912 bytes)
 * - Suite 4: Live PM2 Cluster Mode Spawning (one worker per CPU core, cluster_mode, online status)
 * - Suite 5: Live Worker Crash & Automatic Restart Recovery (SIGKILL worker, verify new PID & restart_time)
 * - Suite 6: Memory Threshold Auto-Restart Configuration & PM2 Cleanup
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const pm2 = require('pm2');

const {
  rotateApplicationLogs,
  pruneOldLogs,
  executeDailyMaintenance,
  formatDate,
  isApplicationRotatedLog,
  APPLICATION_LOG_FILES,
  DEFAULT_RETENTION_DAYS
} = require('../utils/logRotator');

const { validateEcosystemConfig, ensureLogsDirectory } = require('../scripts/setup_pm2');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Promisified PM2 API helpers for reliable async flow
function pm2Connect() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });
}

function pm2Start(options) {
  return new Promise((resolve, reject) => {
    pm2.start(options, (err, apps) => (err ? reject(err) : resolve(apps)));
  });
}

function pm2List() {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => (err ? reject(err) : resolve(list)));
  });
}

function pm2Delete(nameOrId) {
  return new Promise((resolve, reject) => {
    pm2.delete(nameOrId, (err) => (err ? reject(err) : resolve()));
  });
}

function pm2KillDaemon() {
  return new Promise((resolve) => {
    pm2.killDaemon(() => resolve());
  });
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (_) {
    // Process may have already terminated
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-32 PM2 Process Management Test Suite');
  console.log('================================================================\n');

  // ============================================================================
  // Suite 1: Static Configuration Invariants & Schema Verification
  // ============================================================================
  console.log('----------------------------------------------------------------');
  console.log('Suite 1: Static Configuration Invariants & Schema Verification');
  console.log('----------------------------------------------------------------');

  const ecosystemPath = path.join(__dirname, '..', 'ecosystem.config.js');
  assert(fs.existsSync(ecosystemPath), 'ecosystem.config.js exists in project root');

  const ecosystem = require(ecosystemPath);
  assert(Array.isArray(ecosystem.apps) && ecosystem.apps.length > 0, 'ecosystem.apps is a non-empty array');

  const app = ecosystem.apps[0];
  assert(app.name === 'collabide-backend', `app.name is 'collabide-backend' (actual: ${app.name})`);
  assert(app.script === './server.js', `app.script targets './server.js' (actual: ${app.script})`);

  // NFR-32: Cluster mode & CPU cores
  assert(app.exec_mode === 'cluster', `app.exec_mode is 'cluster' (actual: ${app.exec_mode})`);
  assert(
    app.instances === 'max' || process.env.PM2_WORKERS || app.instances === -1 || app.instances === 0,
    `app.instances is configured for full CPU allocation ('max' or PM2_WORKERS)`
  );

  // NFR-32: 512MB memory threshold restart
  assert(
    app.max_memory_restart === '512M' || app.max_memory_restart === '512MB',
    `app.max_memory_restart is '512M' (actual: ${app.max_memory_restart})`
  );

  // NFR-32: Autorestart & Crash Recovery
  assert(app.autorestart === true, `app.autorestart is true (actual: ${app.autorestart})`);

  // NFR-49 & NFR-38 Preservation Invariants
  assert(app.min_uptime === 5000, `app.min_uptime is 5000ms (NFR-49 compliance, actual: ${app.min_uptime})`);
  assert(app.max_restarts === 3, `app.max_restarts is 3 (NFR-49 crash-loop prevention, actual: ${app.max_restarts})`);
  assert(app.restart_delay === 2000, `app.restart_delay is 2000ms (actual: ${app.restart_delay})`);
  assert(
    app.exp_backoff_restart_delay === 1000,
    `app.exp_backoff_restart_delay is 1000ms (NFR-49 compliance, actual: ${app.exp_backoff_restart_delay})`
  );
  assert(
    app.kill_timeout === 12000,
    `app.kill_timeout is 12000ms (NFR-38 graceful shutdown buffer, actual: ${app.kill_timeout})`
  );

  // NFR-32 Log destinations
  assert(app.error_file === './logs/pm2-error.log', `error_file is './logs/pm2-error.log' (actual: ${app.error_file})`);
  assert(app.out_file === './logs/pm2-out.log', `out_file is './logs/pm2-out.log' (actual: ${app.out_file})`);
  assert(app.log_file === './logs/pm2-combined.log', `log_file is './logs/pm2-combined.log' (actual: ${app.log_file})`);

  // NFR-32 Declarative logrotate module configuration
  assert(Boolean(ecosystem.logrotate), 'ecosystem.config.js declares pm2-logrotate configuration block');
  assert(
    ecosystem.logrotate.rotateInterval === '0 0 * * *',
    `logrotate.rotateInterval is '0 0 * * *' (daily midnight, actual: ${ecosystem.logrotate.rotateInterval})`
  );
  assert(
    ecosystem.logrotate.retain === 14,
    `logrotate.retain is 14 days (NFR-32 retention requirement, actual: ${ecosystem.logrotate.retain})`
  );
  assert(
    ecosystem.logrotate.dateFormat === 'YYYY-MM-DD',
    `logrotate.dateFormat is 'YYYY-MM-DD' (actual: ${ecosystem.logrotate.dateFormat})`
  );

  // setup_pm2 validation function
  const setupValidation = validateEcosystemConfig();
  assert(setupValidation.valid === true, 'validateEcosystemConfig() passes with zero schema errors');

  // ============================================================================
  // Suite 2: Application Log Rotation Engine & 14-Day Retention Logic
  // ============================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('Suite 2: Application Log Rotation Engine & 14-Day Retention Logic');
  console.log('----------------------------------------------------------------');

  const scratchLogsDir = path.join(__dirname, 'scratch_logs_test');
  if (fs.existsSync(scratchLogsDir)) {
    fs.rmSync(scratchLogsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(scratchLogsDir, { recursive: true });

  // 2.1 Helper functions test
  assert(formatDate(new Date('2026-10-02T10:00:00Z')) === '2026-10-02', 'formatDate formats Date correctly to YYYY-MM-DD');
  assert(isApplicationRotatedLog('app__2026-10-02.log') === true, 'isApplicationRotatedLog recognizes app__YYYY-MM-DD.log');
  assert(isApplicationRotatedLog('error__2026-10-02.log') === true, 'isApplicationRotatedLog recognizes error__YYYY-MM-DD.log');
  assert(isApplicationRotatedLog('audit__2026-10-02.log') === true, 'isApplicationRotatedLog recognizes audit__YYYY-MM-DD.log');
  assert(isApplicationRotatedLog('app__2026-10-02_1.log') === true, 'isApplicationRotatedLog recognizes sequenced archive');
  assert(isApplicationRotatedLog('pm2-out.log') === false, 'isApplicationRotatedLog strictly rejects active PM2 out log');
  assert(isApplicationRotatedLog('pm2-error.log') === false, 'isApplicationRotatedLog strictly rejects active PM2 error log');
  assert(isApplicationRotatedLog('pm2-out__2026-10-02.log') === false, 'isApplicationRotatedLog strictly rejects PM2 rotated archives');

  // 2.2 Active log rotation and PM2 log isolation
  const activeAppLog = path.join(scratchLogsDir, 'app.log');
  const activeErrorLog = path.join(scratchLogsDir, 'error.log');
  const activeAuditLog = path.join(scratchLogsDir, 'audit.log');
  const activePm2Out = path.join(scratchLogsDir, 'pm2-out.log');
  const activePm2Error = path.join(scratchLogsDir, 'pm2-error.log');

  fs.writeFileSync(activeAppLog, 'APP LOG LINE 1\nAPP LOG LINE 2\n');
  fs.writeFileSync(activeErrorLog, 'ERROR LOG LINE 1\n');
  fs.writeFileSync(activeAuditLog, 'AUDIT LOG LINE 1\n');
  fs.writeFileSync(activePm2Out, 'PM2 STDOUT LINE 1\n');
  fs.writeFileSync(activePm2Error, 'PM2 STDERR LINE 1\n');

  const fixedToday = new Date('2026-10-02T12:00:00Z');
  const rotateResult = rotateApplicationLogs({ logDir: scratchLogsDir, now: fixedToday });

  assert(rotateResult.rotated.length === 3, `rotateApplicationLogs rotated 3 active app files (actual: ${rotateResult.rotated.length})`);
  assert(fs.statSync(activeAppLog).size === 0, 'active app.log was truncated to 0 bytes');
  assert(fs.statSync(activeErrorLog).size === 0, 'active error.log was truncated to 0 bytes');
  assert(fs.statSync(activeAuditLog).size === 0, 'active audit.log was truncated to 0 bytes');

  const expectedAppArchive = path.join(scratchLogsDir, 'app__2026-10-02.log');
  assert(fs.existsSync(expectedAppArchive), 'Archived app__2026-10-02.log exists on disk');
  assert(fs.readFileSync(expectedAppArchive, 'utf8').includes('APP LOG LINE 1'), 'Archived log contains original contents');

  // DUAL-ROTATOR SAFETY CHECK: PM2 logs must NOT be touched
  assert(fs.statSync(activePm2Out).size > 0, 'active pm2-out.log was NOT truncated (strict isolation from PM2 files)');
  assert(fs.statSync(activePm2Error).size > 0, 'active pm2-error.log was NOT truncated (strict isolation from PM2 files)');
  assert(!fs.existsSync(path.join(scratchLogsDir, 'pm2-out__2026-10-02.log')), 'No pm2-out archive was created by app rotator');

  // 2.3 Secondary rotation on the same day appends sequence counter
  fs.writeFileSync(activeAppLog, 'NEW APP LOG DATA AFTER MIDNIGHT\n');
  const secondRotate = rotateApplicationLogs({ logDir: scratchLogsDir, now: fixedToday });
  const sequencedArchive = path.join(scratchLogsDir, 'app__2026-10-02_1.log');
  assert(fs.existsSync(sequencedArchive), 'Second rotation on same day creates sequenced archive app__YYYY-MM-DD_1.log');
  assert(fs.existsSync(expectedAppArchive), 'Original app__2026-10-02.log was preserved without overwrite');

  // 2.4 14-Day Retention Engine Pruning
  // Create archives with varying ages relative to 2026-10-02
  const logsToCreate = [
    { name: 'app__2026-09-28.log', ageDays: 4, expectPurged: false },   // 4 days old <= 14d -> KEEP
    { name: 'error__2026-09-20.log', ageDays: 12, expectPurged: false }, // 12 days old <= 14d -> KEEP
    { name: 'audit__2026-09-18.log', ageDays: 14, expectPurged: false }, // 14 days old <= 14d -> KEEP
    { name: 'app__2026-09-17.log', ageDays: 15, expectPurged: true },   // 15 days old > 14d -> PURGE
    { name: 'audit__2026-09-01.log', ageDays: 31, expectPurged: true },  // 31 days old > 14d -> PURGE
    { name: 'pm2-out__2026-09-01.log', ageDays: 31, expectPurged: false } // PM2 log > 14d -> DO NOT TOUCH
  ];

  for (const item of logsToCreate) {
    const p = path.join(scratchLogsDir, item.name);
    fs.writeFileSync(p, `LOG CONTENT FOR ${item.name}`);
  }

  const pruneResult = pruneOldLogs({
    logDir: scratchLogsDir,
    retentionDays: 14,
    now: fixedToday
  });

  assert(pruneResult.purged.length === 2, `pruneOldLogs purged exactly 2 expired app archives (actual: ${pruneResult.purged.length})`);
  assert(!fs.existsSync(path.join(scratchLogsDir, 'app__2026-09-17.log')), '15-day-old app archive was purged');
  assert(!fs.existsSync(path.join(scratchLogsDir, 'audit__2026-09-01.log')), '31-day-old audit archive was purged');
  assert(fs.existsSync(path.join(scratchLogsDir, 'audit__2026-09-18.log')), '14-day-old audit archive was retained');
  assert(fs.existsSync(path.join(scratchLogsDir, 'error__2026-09-20.log')), '12-day-old error archive was retained');
  assert(fs.existsSync(path.join(scratchLogsDir, 'app__2026-09-28.log')), '4-day-old app archive was retained');

  // PM2 file must NOT be purged by application log rotator
  assert(
    fs.existsSync(path.join(scratchLogsDir, 'pm2-out__2026-09-01.log')),
    '31-day-old pm2-out archive was NOT purged by application log rotator (exclusively managed by pm2-logrotate)'
  );

  // Clean up scratch dir
  fs.rmSync(scratchLogsDir, { recursive: true, force: true });

  // ============================================================================
  // Suite 3: Memory Limit Calculation & Unit Conversions
  // ============================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('Suite 3: Memory Limit Calculation & Unit Conversions');
  console.log('----------------------------------------------------------------');

  const EXPECTED_BYTES_512MB = 512 * 1024 * 1024; // 536,870,912 bytes
  assert(EXPECTED_BYTES_512MB === 536870912, '512MB binary size evaluates to 536,870,912 bytes');

  function parseMemoryString(memStr) {
    if (typeof memStr === 'number') return memStr;
    const match = String(memStr).match(/^(\d+(?:\.\d+)?)\s*([KMGTP]?B?)$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit.startsWith('G')) return Math.round(num * 1024 * 1024 * 1024);
    if (unit.startsWith('M')) return Math.round(num * 1024 * 1024);
    if (unit.startsWith('K')) return Math.round(num * 1024);
    return Math.round(num);
  }

  assert(parseMemoryString('512M') === 536870912, "parseMemoryString('512M') yields 536,870,912 bytes");
  assert(parseMemoryString('512MB') === 536870912, "parseMemoryString('512MB') yields 536,870,912 bytes");
  assert(parseMemoryString('1G') === 1073741824, "parseMemoryString('1G') yields 1,073,741,824 bytes");

  // ============================================================================
  // Suite 4: Live PM2 Cluster Mode Process Spawning
  // ============================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('Suite 4: Live PM2 Cluster Mode Process Spawning');
  console.log('----------------------------------------------------------------');

  const fixtureScript = path.join(__dirname, 'fixtures', 'worker_fixture.js');
  assert(fs.existsSync(fixtureScript), 'Test worker fixture exists at test/fixtures/worker_fixture.js');

  const numCpus = os.cpus().length;
  console.log(`[TEST-SUITE] Detected ${numCpus} logical CPU cores on host machine.`);

  // Connect to PM2 daemon
  await pm2Connect();
  console.log('[TEST-SUITE] Connected to PM2 programmatic daemon.');

  // Clean slate: delete test-cluster if previously running
  try {
    await pm2Delete('test-cluster');
  } catch (_) {}

  // Spawn cluster with instances: 'max' (or numCpus)
  const clusterStartConfig = {
    name: 'test-cluster',
    script: fixtureScript,
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '512M',
    autorestart: true,
    kill_timeout: 12000,
    wait_ready: true,
    listen_timeout: 8000,
    env: {
      TEST_PORT: 3987
    }
  };

  await pm2Start(clusterStartConfig);
  console.log(`[TEST-SUITE] Started 'test-cluster' with instances: 'max'. Waiting for workers to report online...`);

  // Allow up to 10 seconds for workers to come online
  let onlineWorkers = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(500);
    const list = await pm2List();
    const clusterProcs = list.filter((p) => p.name === 'test-cluster');
    onlineWorkers = clusterProcs.filter((p) => p.pm2_env.status === 'online');
    if (onlineWorkers.length === numCpus) {
      break;
    }
  }

  assert(
    onlineWorkers.length === numCpus,
    `PM2 spawned exactly ${numCpus} workers (one per CPU core, actual: ${onlineWorkers.length})`
  );

  let allClusterMode = true;
  let allMemoryThresholdSet = true;
  let allValidPids = true;

  for (const worker of onlineWorkers) {
    if (worker.pm2_env.exec_mode !== 'cluster_mode') allClusterMode = false;
    if (worker.pm2_env.max_memory_restart !== 536870912) allMemoryThresholdSet = false;
    if (!worker.pid || worker.pid <= 0) allValidPids = false;
  }

  assert(allClusterMode, "All worker processes run with exec_mode: 'cluster_mode'");
  assert(
    allMemoryThresholdSet,
    'All worker processes configure max_memory_restart: 536870912 (512MB in bytes)'
  );
  assert(allValidPids, 'All online worker processes have active, valid OS PIDs');

  // ============================================================================
  // Suite 5: Live Worker Crash & Automatic Restart Recovery
  // ============================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('Suite 5: Live Worker Crash & Automatic Restart Recovery');
  console.log('----------------------------------------------------------------');

  const targetWorker = onlineWorkers[0];
  const targetPmId = targetWorker.pm_id;
  const initialPid = targetWorker.pid;
  const initialRestartCount = targetWorker.pm2_env.restart_time || 0;

  console.log(`[TEST-SUITE] Killing worker (pm_id: ${targetPmId}, PID: ${initialPid}) with SIGKILL...`);
  killPid(initialPid);

  // Poll PM2 for automatic restart
  let restartedWorker = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    await sleep(400);
    const list = await pm2List();
    const currentWorker = list.find((p) => p.pm_id === targetPmId);
    if (
      currentWorker &&
      currentWorker.pid &&
      currentWorker.pid !== initialPid &&
      currentWorker.pm2_env.status === 'online'
    ) {
      restartedWorker = currentWorker;
      break;
    }
  }

  assert(restartedWorker !== null, `PM2 automatically detected crash and restarted worker pm_id: ${targetPmId}`);
  assert(
    restartedWorker.pid !== initialPid,
    `Restarted worker has new OS PID (initial: ${initialPid}, new: ${restartedWorker.pid})`
  );
  assert(
    (restartedWorker.pm2_env.restart_time || 0) > initialRestartCount,
    `Worker restart_time counter was incremented (initial: ${initialRestartCount}, new: ${restartedWorker.pm2_env.restart_time})`
  );
  assert(restartedWorker.pm2_env.status === 'online', "Restarted worker status is 'online'");

  // Verify total online workers is restored to CPU count
  const refreshedList = await pm2List();
  const refreshedCluster = refreshedList.filter((p) => p.name === 'test-cluster' && p.pm2_env.status === 'online');
  assert(
    refreshedCluster.length === numCpus,
    `Cluster worker count restored to full CPU core capacity (${numCpus})`
  );

  // Clean up test cluster
  await pm2Delete('test-cluster');
  console.log("[TEST-SUITE] Stopped and deleted 'test-cluster'.");

  // ============================================================================
  // Suite 6: Memory Threshold Auto-Restart Configuration & PM2 Cleanup
  // ============================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('Suite 6: Memory Threshold Auto-Restart Configuration & PM2 Cleanup');
  console.log('----------------------------------------------------------------');

  const memFixtureScript = path.join(__dirname, 'fixtures', 'memory_fixture.js');
  assert(fs.existsSync(memFixtureScript), 'Memory test fixture exists at test/fixtures/memory_fixture.js');

  // Clean slate for test-mem-app
  try {
    await pm2Delete('test-mem-app');
  } catch (_) {}

  // Test starting single worker with max_memory_restart: '80M'
  await pm2Start({
    name: 'test-mem-app',
    script: memFixtureScript,
    instances: 1,
    exec_mode: 'cluster',
    max_memory_restart: '80M',
    autorestart: true
  });

  await sleep(1500);
  const memList = await pm2List();
  const memProc = memList.find((p) => p.name === 'test-mem-app');

  assert(Boolean(memProc), "Started 'test-mem-app' successfully");
  assert(
    memProc.pm2_env.max_memory_restart === 80 * 1024 * 1024,
    `memProc.max_memory_restart correctly parsed to 83,886,080 bytes (actual: ${memProc.pm2_env.max_memory_restart})`
  );
  assert(memProc.pm2_env.status === 'online', "Memory fixture worker is 'online'");

  // Delete test-mem-app
  await pm2Delete('test-mem-app');
  console.log("[TEST-SUITE] Cleaned up 'test-mem-app'.");

  // Cleanly shut down PM2 test daemon
  console.log('[TEST-SUITE] Killing PM2 test daemon...');
  await pm2KillDaemon();
  console.log('[TEST-SUITE] PM2 daemon stopped cleanly.');

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n================================================================');
  console.log(`Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runTestSuite().catch(async (err) => {
    console.error(`[TEST-SUITE FATAL ERROR]: ${err.stack || err.message}`);
    try {
      await pm2KillDaemon();
    } catch (_) {}
    process.exit(1);
  });
}

module.exports = { runTestSuite };
