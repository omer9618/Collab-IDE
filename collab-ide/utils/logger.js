/**
 * @file utils/logger.js
 * @module utils/logger
 * @description Centralized Security-Hardened Application Logger (NFR-23).
 *
 * Implements strict security policies prohibiting sensitive data exposure in logs:
 * 1. Sensitive Data Redaction:
 *    - Passwords & Hashes: Plain passwords, new/current passwords, reset tokens.
 *    - JWT Tokens: Asymmetric RS256 access tokens (eyJ...).
 *    - Refresh Tokens: Opaque refresh token strings and family IDs.
 *    - Raw Email Addresses: Full email addresses are masked or redacted to protect PII.
 *    - Code Content: User source code, file buffer contents, execution payloads, and stdin.
 * 2. Actor and Resource Identifiers:
 *    - Log entries strictly use User IDs (e.g. `User: 65a...`) and Room IDs (e.g. `Room: c56...`)
 *      rather than raw email addresses or personal names.
 * 3. Restricted Filesystem Permissions (chmod 640):
 *    - Log directory permissions are enforced to 0750 (drwxr-x---).
 *    - Log files (app.log, error.log, audit.log) are opened and set to chmod 640 (-rw-r-----),
 *      ensuring owner read/write, group read, and zero public permissions on POSIX systems.
 * 4. Automatic Console Interceptor:
 *    - Wraps global `console.log`, `console.info`, `console.warn`, and `console.error`
 *      to ensure third-party modules or unmigrated calls cannot leak sensitive data.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const APP_LOG_PATH = path.join(LOG_DIR, 'app.log');
const ERROR_LOG_PATH = path.join(LOG_DIR, 'error.log');
const AUDIT_LOG_PATH = path.join(LOG_DIR, 'audit.log');

// Filesystem permission modes (NFR-23)
const DIR_MODE = 0o750; // drwxr-x---
const FILE_MODE = 0o640; // -rw-r-----

/**
 * Initializes the log directory and log files with chmod 640 permissions (NFR-23).
 */
function initLogStorage() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true, mode: DIR_MODE });
      try {
        fs.chmodSync(LOG_DIR, DIR_MODE);
      } catch (_) {}
    }

    [APP_LOG_PATH, ERROR_LOG_PATH, AUDIT_LOG_PATH].forEach((filePath) => {
      if (!fs.existsSync(filePath)) {
        const fd = fs.openSync(filePath, 'a', FILE_MODE);
        fs.closeSync(fd);
      }
      try {
        fs.chmodSync(filePath, FILE_MODE);
      } catch (_) {
        // Windows filesystem does not implement POSIX permission bits
      }
    });
  } catch (err) {
    process.stderr.write(`[LOGGER INIT ERROR] Failed to initialize log storage: ${err.message}\n`);
  }
}

// Sensitive object keys that must be redacted (case-insensitive)
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /newpassword/i,
  /currentpassword/i,
  /confirmpassword/i,
  /secret/i,
  /passwd/i,
  /^pass$/i,
  /^pwd$/i,
  /refreshtoken/i,
  /accesstoken/i,
  /verificationtoken/i,
  /resetpasswordtoken/i,
  /pendingemailtoken/i,
  /resettoken/i,
  /authorization/i,
  /cookie/i,
  /set-cookie/i,
  /^token$/i,
  /^code$/i,
  /^source_code$/i,
  /^sourcecode$/i,
  /^content$/i,
  /^stdin$/i,
  /^ydocstate$/i,
  /^email$/i,
  /^pendingemail$/i,
  /^normalizedemail$/i,
];

// String regex patterns to redact sensitive data from unstructured log strings
const REGEX_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const REGEX_JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g;
const REGEX_BEARER = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const REGEX_HEX_TOKEN = /\b[0-9a-f]{80}\b/gi;
const REGEX_URL_PARAMS = /(?:token|tokenHash|resetToken|verificationToken|pendingEmailToken|refreshToken|password|newPassword|pass|pwd)=([^&\s;#]+)/gi;
const REGEX_PASSWORD_KV = /(?:["']?)(password|newpassword|currentpassword|confirmpassword|secret|passwd|pass|pwd)(?:["']?)\s*[:=]\s*(?!\[REDACTED)("[^"]*"|'[^']*'|`[^`]*`|[^\s,;{}]+)/gi;
const REGEX_TOKEN_KV = /(?:["']?)(refreshToken|accessToken|verificationToken|resetPasswordToken|pendingEmailToken|resetToken|token)(?:["']?)\s*[:=]\s*(?!\[REDACTED)("[^"]*"|'[^']*'|`[^`]*`|[^\s,;{}]+)/gi;
const REGEX_CODE_KV = /(?:["']?)(source_code|sourcecode|code|content|stdin|ydocState)(?:["']?)\s*[:=]\s*(?!\[REDACTED)("[^"]*"|'[^']*'|`[^`]*`|[^\r\n,{}]+)/gi;
const REGEX_CODE_BLOCK = /(?:```|~~~)[\s\S]*?(?:```|~~~)/g;
const REGEX_CODE_TAGS = /<(script|style|html|body)[^>]*>[\s\S]*?<\/\1>/gi;
const REGEX_CODE_FN = /(?:function\s*\w*\s*\([^)]*\)\s*\{[\s\S]*?\}|def\s+\w+\s*\([^)]*\)\s*:[\s\S]*?(?=\n\S|\n$|$)|(?:public|private|protected)\s+(?:class|void|int|String|boolean)[\s\S]*?\{[\s\S]*?\})/g;

/**
 * Sanitizes a plain text string by redacting emails, JWTs, Bearer headers, and URL credentials.
 *
 * @param {string} str - Raw string
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;

  return str
    .replace(REGEX_URL_PARAMS, (match) => {
      const paramName = match.split('=')[0];
      return `${paramName}=[REDACTED]`;
    })
    .replace(REGEX_JWT, '[REDACTED_JWT]')
    .replace(REGEX_BEARER, 'Bearer [REDACTED_TOKEN]')
    .replace(REGEX_HEX_TOKEN, '[REDACTED_REFRESH_TOKEN]')
    .replace(REGEX_PASSWORD_KV, (_, key) => `"${key}": [REDACTED_PASSWORD]`)
    .replace(REGEX_TOKEN_KV, (_, key) => `"${key}": [REDACTED_TOKEN]`)
    .replace(REGEX_CODE_KV, (_, key) => `"${key}": [REDACTED_CODE]`)
    .replace(REGEX_CODE_BLOCK, '[REDACTED_CODE_BLOCK]')
    .replace(REGEX_CODE_TAGS, '[REDACTED_CODE]')
    .replace(REGEX_CODE_FN, '[REDACTED_CODE]')
    .replace(REGEX_EMAIL, () => '[REDACTED_EMAIL]');
}

/**
 * Deeply sanitizes any arbitrary JavaScript value (object, array, primitive, Error).
 * Replaces sensitive keys and string patterns according to NFR-23.
 *
 * @param {*} value - Value to sanitize
 * @param {string} [parentKey=''] - Object key name for contextual redaction
 * @param {WeakSet} [seen] - Set of visited objects to prevent circular reference cycles
 * @returns {*} Sanitized representation safe for logging
 */
function sanitizeValue(value, parentKey = '', seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  // Check if parent key name is marked as sensitive
  if (parentKey && SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(parentKey))) {
    if (/password|pass|pwd|secret/i.test(parentKey)) return '[REDACTED_PASSWORD]';
    if (/email/i.test(parentKey)) return '[REDACTED_EMAIL]';
    if (/token|auth|cookie/i.test(parentKey)) return '[REDACTED_TOKEN]';
    if (/code|content|stdin|ydoc/i.test(parentKey)) return '[REDACTED_CODE]';
    return '[REDACTED]';
  }

  // Handle primitives
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (typeof value !== 'object') {
    return value;
  }

  // Handle Error instances
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: sanitizeString(value.stack || ''),
    };
  }

  // Prevent infinite loops on circular references
  if (seen.has(value)) {
    return '[CIRCULAR_REF]';
  }
  seen.add(value);

  // Handle Arrays
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, parentKey, seen));
  }

  // Handle plain objects
  const sanitizedObj = {};
  for (const [k, v] of Object.entries(value)) {
    sanitizedObj[k] = sanitizeValue(v, k, seen);
  }
  return sanitizedObj;
}

/**
 * Appends a log line to a specified log file, verifying chmod 640 permissions (NFR-23).
 *
 * @param {string} filePath - Absolute path to log file
 * @param {string} line - Formatted log entry
 */
function writeToFile(filePath, line) {
  try {
    if (!fs.existsSync(filePath)) {
      const fd = fs.openSync(filePath, 'a', FILE_MODE);
      fs.closeSync(fd);
      try {
        fs.chmodSync(filePath, FILE_MODE);
      } catch (_) {}
    }
    fs.appendFileSync(filePath, line + '\n', { mode: FILE_MODE });
  } catch (err) {
    process.stderr.write(`[LOG WRITE ERROR] Could not write to ${filePath}: ${err.message}\n`);
  }
}

/**
 * Formats a log entry using standard timestamp, level, user ID, and room ID identifiers.
 *
 * @param {string} level - 'INFO' | 'WARN' | 'ERROR' | 'AUDIT'
 * @param {string} message - Human-readable log summary
 * @param {Object} [meta={}] - Structured metadata
 * @param {string} [meta.userId] - Subject user ID identifier
 * @param {string} [meta.roomId] - Target room ID identifier
 * @returns {string} Formatted log entry
 */
function formatLogEntry(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const userId = meta.userId || meta.user_id || meta._id || 'SYSTEM';
  const roomId = meta.roomId || meta.roomUuid || meta.room_id || 'N/A';

  const sanitizedMessage = sanitizeString(String(message));
  const sanitizedMeta = Object.keys(meta).length > 0 ? sanitizeValue(meta) : null;

  let entry = `[${timestamp}] [${level}] [User: ${userId}] [Room: ${roomId}] ${sanitizedMessage}`;
  if (sanitizedMeta) {
    const metaCopy = { ...sanitizedMeta };
    delete metaCopy.userId;
    delete metaCopy.user_id;
    delete metaCopy.roomId;
    delete metaCopy.roomUuid;
    delete metaCopy.room_id;
    if (Object.keys(metaCopy).length > 0) {
      entry += ` | ${JSON.stringify(metaCopy)}`;
    }
  }
  return entry;
}

// Initialize filesystem paths and permissions immediately
initLogStorage();

/**
 * Centralized Logger Object (NFR-23).
 */
const logger = {
  /**
   * Log an informational message.
   *
   * @param {string} message - Message description
   * @param {Object} [meta] - Context identifiers ({ userId, roomId, ... })
   */
  info(message, meta = {}) {
    const entry = formatLogEntry('INFO', message, meta);
    process.stdout.write(entry + '\n');
    writeToFile(APP_LOG_PATH, entry);
  },

  /**
   * Log a security or operational warning.
   *
   * @param {string} message - Warning description
   * @param {Object} [meta] - Context identifiers ({ userId, roomId, ... })
   */
  warn(message, meta = {}) {
    const entry = formatLogEntry('WARN', message, meta);
    process.stdout.write(entry + '\n');
    writeToFile(APP_LOG_PATH, entry);
  },

  /**
   * Log an application or system error.
   *
   * @param {string|Error} error - Error object or error message
   * @param {Object} [meta] - Context identifiers ({ userId, roomId, ... })
   */
  error(error, meta = {}) {
    let msg = error;
    if (error instanceof Error) {
      msg = error.message;
      meta = { ...meta, stack: error.stack };
    }
    const entry = formatLogEntry('ERROR', msg, meta);
    process.stderr.write(entry + '\n');
    writeToFile(APP_LOG_PATH, entry);
    writeToFile(ERROR_LOG_PATH, entry);
  },

  /**
   * Log an audit trail entry for security-relevant events (e.g. auth, role promotion).
   *
   * @param {string} action - Security event action name
   * @param {Object} details - Event details ({ userId, roomId, ... })
   */
  audit(action, details = {}) {
    const entry = formatLogEntry('AUDIT', action, details);
    process.stdout.write(entry + '\n');
    writeToFile(AUDIT_LOG_PATH, entry);
    writeToFile(APP_LOG_PATH, entry);
  },

  // Export utilities for external consumers and unit testing
  sanitizeValue,
  sanitizeString,
  initLogStorage,
  APP_LOG_PATH,
  ERROR_LOG_PATH,
  AUDIT_LOG_PATH,
  FILE_MODE,

  /**
   * Installs a universal console proxy to intercept and sanitize all `console.log`,
   * `console.info`, `console.warn`, and `console.error` calls across the runtime (NFR-23).
   */
  installGlobalInterceptor() {
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;

    console.log = (...args) => {
      const sanitized = args.map((arg) => sanitizeValue(arg));
      origLog(...sanitized);
      const str = sanitized.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      writeToFile(APP_LOG_PATH, `[${new Date().toISOString()}] [LOG] ${str}`);
    };

    console.info = (...args) => {
      const sanitized = args.map((arg) => sanitizeValue(arg));
      origInfo(...sanitized);
      const str = sanitized.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      writeToFile(APP_LOG_PATH, `[${new Date().toISOString()}] [INFO] ${str}`);
    };

    console.warn = (...args) => {
      const sanitized = args.map((arg) => sanitizeValue(arg));
      origWarn(...sanitized);
      const str = sanitized.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      writeToFile(APP_LOG_PATH, `[${new Date().toISOString()}] [WARN] ${str}`);
    };

    console.error = (...args) => {
      const sanitized = args.map((arg) => sanitizeValue(arg));
      origError(...sanitized);
      const str = sanitized.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      writeToFile(APP_LOG_PATH, `[${new Date().toISOString()}] [ERROR] ${str}`);
      writeToFile(ERROR_LOG_PATH, `[${new Date().toISOString()}] [ERROR] ${str}`);
    };

    return () => {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
    };
  },
};

module.exports = logger;
