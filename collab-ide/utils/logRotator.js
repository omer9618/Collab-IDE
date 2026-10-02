/**
 * @file utils/logRotator.js
 * @module utils/logRotator
 * @description Application-Level Daily Log Rotation and 14-Day Retention Engine (NFR-32, NFR-23).
 *
 * SCOPE & RESPONSIBILITY SEPARATION:
 * - This utility strictly and exclusively manages internal application logs (app.log, error.log, audit.log).
 * - It explicitly EXCLUDES PM2 stdout/stderr files (pm2-out.log, pm2-error.log, pm2-combined.log),
 *   which are natively and exclusively rotated by the `pm2-logrotate` module.
 * - This strict separation eliminates dual-rotator race conditions, file handle collisions,
 *   and log truncation during simultaneous midnight writes.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_DIR = path.join(__dirname, '..', 'logs');
const FILE_MODE = 0o640; // POSIX owner read/write, group read, others zero (NFR-23)
const DEFAULT_RETENTION_DAYS = 14; // NFR-32 specification

// Explicit list of application-level log base names managed by this engine
const APPLICATION_LOG_FILES = ['app.log', 'error.log', 'audit.log'];

/**
 * Formats a Date object into YYYY-MM-DD format.
 *
 * @param {Date|number} [date=new Date()]
 * @returns {string} Formatted date string (e.g. "2026-10-02")
 */
function formatDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks if a given filename is an application rotated archive.
 * Matches: app__YYYY-MM-DD.log, error__YYYY-MM-DD.log, audit__YYYY-MM-DD.log
 * Explicitly rejects: pm2-out*.log, pm2-error*.log
 *
 * @param {string} fileName
 * @returns {boolean}
 */
function isApplicationRotatedLog(fileName) {
  if (fileName.startsWith('pm2-')) return false;
  return /^(app|error|audit)__\d{4}-\d{2}-\d{2}(?:_\d+)?\.log$/.test(fileName);
}

/**
 * Rotates an active application log file by archiving its current contents
 * and truncating the active file in-place, preserving open descriptors and chmod 640.
 *
 * @param {string} filePath - Absolute path to active log file
 * @param {string} dateStr - Date string suffix (YYYY-MM-DD)
 * @returns {string|null} Path to rotated archive file, or null if file was empty/absent
 */
function rotateLogFile(filePath, dateStr) {
  if (!fs.existsSync(filePath)) return null;

  const stat = fs.statSync(filePath);
  if (stat.size === 0) return null; // Do not rotate empty files

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);

  let archiveName = `${baseName}__${dateStr}${ext}`;
  let archivePath = path.join(dir, archiveName);

  // If archive for today already exists, append sequence counter
  let counter = 1;
  while (fs.existsSync(archivePath)) {
    archiveName = `${baseName}__${dateStr}_${counter}${ext}`;
    archivePath = path.join(dir, archiveName);
    counter++;
  }

  // Atomically copy file contents to archive
  fs.copyFileSync(filePath, archivePath);

  try {
    fs.chmodSync(archivePath, FILE_MODE);
  } catch (_) {
    // Windows non-POSIX fallback
  }

  // Truncate active file in place to maintain open file handles
  fs.truncateSync(filePath, 0);

  return archivePath;
}

/**
 * Rotates all active application logs (app.log, error.log, audit.log) for a specified day.
 *
 * @param {Object} [options={}]
 * @param {string} [options.logDir=DEFAULT_LOG_DIR] - Directory containing logs
 * @param {Date|number} [options.now=new Date()] - Reference timestamp
 * @returns {{ rotated: string[], skipped: string[] }}
 */
function rotateApplicationLogs(options = {}) {
  const logDir = options.logDir || DEFAULT_LOG_DIR;
  const now = options.now ? new Date(options.now) : new Date();
  const dateStr = formatDate(now);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const rotated = [];
  const skipped = [];

  for (const fileName of APPLICATION_LOG_FILES) {
    const filePath = path.join(logDir, fileName);
    const archivePath = rotateLogFile(filePath, dateStr);
    if (archivePath) {
      rotated.push(archivePath);
    } else {
      skipped.push(filePath);
    }
  }

  return { rotated, skipped };
}

/**
 * Scans the log directory for rotated application log archives older than retentionDays
 * and purges them to enforce NFR-32's 14-day retention requirement.
 *
 * @param {Object} [options={}]
 * @param {string} [options.logDir=DEFAULT_LOG_DIR] - Directory containing logs
 * @param {number} [options.retentionDays=DEFAULT_RETENTION_DAYS] - Maximum retention in days (14)
 * @param {Date|number} [options.now=new Date()] - Reference timestamp
 * @returns {{ purged: string[], retained: string[] }}
 */
function pruneOldLogs(options = {}) {
  const logDir = options.logDir || DEFAULT_LOG_DIR;
  const retentionDays = options.retentionDays !== undefined ? options.retentionDays : DEFAULT_RETENTION_DAYS;
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

  if (!fs.existsSync(logDir)) {
    return { purged: [], retained: [] };
  }

  const files = fs.readdirSync(logDir);
  const purged = [];
  const retained = [];

  for (const file of files) {
    // Strictly filter to application-level rotated archives
    if (!isApplicationRotatedLog(file)) continue;

    const fullPath = path.join(logDir, file);
    let dayDiff;

    // Extract date from filename if possible: [base]__[YYYY-MM-DD].log
    const match = file.match(/__(\d{4}-\d{2}-\d{2})/);
    if (match && match[1]) {
      const fileDate = new Date(`${match[1]}T00:00:00Z`).getTime();
      const todayDate = new Date(`${formatDate(now)}T00:00:00Z`).getTime();
      dayDiff = Math.floor((todayDate - fileDate) / (24 * 60 * 60 * 1000));
    } else {
      const stat = fs.statSync(fullPath);
      dayDiff = Math.floor((now - stat.mtimeMs) / (24 * 60 * 60 * 1000));
    }

    if (dayDiff > retentionDays) {
      try {
        fs.unlinkSync(fullPath);
        purged.push(fullPath);
      } catch (err) {
        process.stderr.write(`[LOG ROTATOR] Failed to purge old log ${file}: ${err.message}\n`);
      }
    } else {
      retained.push(fullPath);
    }
  }

  return { purged, retained };
}

/**
 * Performs complete daily maintenance: rotates active application logs and prunes logs > 14 days old.
 *
 * @param {Object} [options={}]
 * @returns {{ rotated: string[], purged: string[], retained: string[] }}
 */
function executeDailyMaintenance(options = {}) {
  const rotateResult = rotateApplicationLogs(options);
  const pruneResult = pruneOldLogs(options);

  return {
    rotated: rotateResult.rotated,
    skipped: rotateResult.skipped,
    purged: pruneResult.purged,
    retained: pruneResult.retained,
  };
}

module.exports = {
  rotateApplicationLogs,
  pruneOldLogs,
  executeDailyMaintenance,
  formatDate,
  isApplicationRotatedLog,
  APPLICATION_LOG_FILES,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_LOG_DIR,
};
