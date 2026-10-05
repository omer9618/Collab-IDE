/**
 * @file scripts/setup_pm2.js
 * @description Setup and Configuration Script for PM2 and pm2-logrotate (NFR-32).
 * 
 * Verifies ecosystem configuration and configures pm2-logrotate module parameters:
 * - rotateInterval: '0 0 * * *' (midnight daily rotation)
 * - retain: 14 (14 days log retention)
 * - dateFormat: 'YYYY-MM-DD'
 * - max_size: '10M'
 * - workerInterval: 30
 * - rotateModule: true
 */

const fs = require('fs');
const path = require('path');
const pm2 = require('pm2');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const ECOSYSTEM_PATH = path.join(PROJECT_ROOT, 'ecosystem.config.js');

/**
 * Validates the ecosystem.config.js against NFR-32 requirements.
 */
function validateEcosystemConfig() {
  if (!fs.existsSync(ECOSYSTEM_PATH)) {
    throw new Error(`ecosystem.config.js not found at ${ECOSYSTEM_PATH}`);
  }

  // Clear module cache to allow fresh reload if modified
  delete require.cache[require.resolve(ECOSYSTEM_PATH)];
  const config = require(ECOSYSTEM_PATH);

  if (!config.apps || !Array.isArray(config.apps) || config.apps.length === 0) {
    throw new Error('ecosystem.config.js must export an apps array with at least one app');
  }

  const app = config.apps[0];

  // Invariant 1: Cluster Mode
  if (app.exec_mode !== 'cluster') {
    throw new Error(`Invalid exec_mode: expected 'cluster', got '${app.exec_mode}'`);
  }

  // Invariant 2: CPU cores instantiation
  if (app.instances !== 'max' && app.instances !== -1 && app.instances !== 0) {
    if (typeof app.instances !== 'number' && app.instances !== 'max') {
      throw new Error(`Invalid instances: expected 'max', got '${app.instances}'`);
    }
  }

  // Invariant 3: Memory threshold 512MB
  if (app.max_memory_restart !== '512M' && app.max_memory_restart !== '512MB') {
    throw new Error(`Invalid max_memory_restart: expected '512M', got '${app.max_memory_restart}'`);
  }

  // Invariant 4: Autorestart enabled
  if (app.autorestart !== true) {
    throw new Error(`Invalid autorestart: expected true, got '${app.autorestart}'`);
  }

  // Invariant 5: Declarative logrotate config
  if (!config.logrotate) {
    throw new Error('ecosystem.config.js must specify a logrotate configuration block');
  }

  if (config.logrotate.rotateInterval !== '0 0 * * *') {
    throw new Error(`Invalid logrotate.rotateInterval: expected '0 0 * * *', got '${config.logrotate.rotateInterval}'`);
  }

  if (config.logrotate.retain !== 14) {
    throw new Error(`Invalid logrotate.retain: expected 14, got '${config.logrotate.retain}'`);
  }

  return { valid: true, app, logrotate: config.logrotate };
}

/**
 * Ensures the project logs directory exists with appropriate permissions.
 */
function ensureLogsDirectory() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o750 });
    console.log(`[SETUP-PM2] Created logs directory: ${LOGS_DIR}`);
  } else {
    console.log(`[SETUP-PM2] Logs directory exists: ${LOGS_DIR}`);
  }
}

/**
 * Configures pm2-logrotate module parameters via PM2 programmatic API.
 *
 * @returns {Promise<number>} Number of successfully set configurations
 */
function configurePm2Logrotate() {
  return new Promise((resolve, reject) => {
    const configs = [
      { key: 'pm2-logrotate:rotateInterval', val: '0 0 * * *' },
      { key: 'pm2-logrotate:retain', val: '14' },
      { key: 'pm2-logrotate:dateFormat', val: 'YYYY-MM-DD' },
      { key: 'pm2-logrotate:max_size', val: '10M' },
      { key: 'pm2-logrotate:workerInterval', val: '30' },
      { key: 'pm2-logrotate:rotateModule', val: 'true' }
    ];

    console.log('[SETUP-PM2] Applying pm2-logrotate configuration via PM2 API...');

    pm2.connect((connectErr) => {
      if (connectErr) {
        console.warn(`[SETUP-PM2] Warning: Could not connect to PM2 daemon (${connectErr.message}). Declarative ecosystem config will be used.`);
        return resolve(0);
      }

      let successCount = 0;
      let currentIndex = 0;

      function setNext() {
        if (currentIndex >= configs.length) {
          pm2.disconnect();
          console.log(`[SETUP-PM2] Successfully configured ${successCount}/${configs.length} pm2-logrotate keys.`);
          return resolve(successCount);
        }

        const cfg = configs[currentIndex++];
        pm2.set(cfg.key, cfg.val, (err) => {
          if (err) {
            console.warn(`[SETUP-PM2] Could not set ${cfg.key}: ${err.message}`);
          } else {
            successCount++;
          }
          setNext();
        });
      }

      setNext();
    });
  });
}

/**
 * Main setup runner.
 */
async function runSetup() {
  console.log('====================================================');
  console.log(' CollabIDE - PM2 & Logrotate Setup (NFR-32)');
  console.log('====================================================');

  ensureLogsDirectory();
  const validation = validateEcosystemConfig();
  console.log('[SETUP-PM2] ecosystem.config.js validation: PASSED');
  console.log(`  - Exec Mode: ${validation.app.exec_mode}`);
  console.log(`  - Instances: ${validation.app.instances}`);
  console.log(`  - Max Memory Restart: ${validation.app.max_memory_restart}`);
  console.log(`  - Autorestart: ${validation.app.autorestart}`);
  console.log(`  - Logrotate Interval: ${validation.logrotate.rotateInterval} (daily midnight)`);
  console.log(`  - Logrotate Retain: ${validation.logrotate.retain} days`);

  await configurePm2Logrotate();

  console.log('[SETUP-PM2] Setup complete.');
}

if (require.main === module) {
  runSetup().catch((err) => {
    console.error(`[SETUP-PM2] Setup failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  validateEcosystemConfig,
  ensureLogsDirectory,
  configurePm2Logrotate,
  runSetup
};
