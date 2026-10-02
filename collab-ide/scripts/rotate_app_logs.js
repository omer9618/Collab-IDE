/**
 * @file scripts/rotate_app_logs.js
 * @description CLI runner for application log rotation and 14-day retention maintenance (NFR-32, NFR-23).
 * Triggered by cron, CI/CD, Windows Task Scheduler, or `npm run logs:rotate`.
 * 
 * Strictly targets application logs (app.log, error.log, audit.log).
 * Does not touch pm2-*.log files.
 */

const { executeDailyMaintenance } = require('../utils/logRotator');

function main() {
  console.log('====================================================');
  console.log(' CollabIDE - Application Log Maintenance (NFR-32)');
  console.log('====================================================');
  console.log('[LOG-MAINTENANCE] Starting application log rotation & 14-day retention cleanup...');

  const result = executeDailyMaintenance();

  console.log(`[LOG-MAINTENANCE] Rotated ${result.rotated.length} active application files:`);
  for (const r of result.rotated) {
    console.log(`  + ${r}`);
  }

  if (result.skipped.length > 0) {
    console.log(`[LOG-MAINTENANCE] Skipped ${result.skipped.length} empty or missing files.`);
  }

  console.log(`[LOG-MAINTENANCE] Purged ${result.purged.length} archives older than 14 days:`);
  for (const p of result.purged) {
    console.log(`  - ${p}`);
  }

  console.log(`[LOG-MAINTENANCE] Retained ${result.retained.length} active archives within 14-day retention window.`);
  console.log('[LOG-MAINTENANCE] Maintenance complete.');
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[LOG-MAINTENANCE] Maintenance failed:', err.message);
    process.exit(1);
  }
}

module.exports = { main };
