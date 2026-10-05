/**
 * @file config/env.js
 * @module config/env
 * @description Centralized Environment Configuration & Fail-Fast Startup Validator (NFR-49).
 *
 * SPECIFICATION (NFR-49):
 * All environment-specific values must be stored in `.env`. No values may be hardcoded.
 * The application must fail fast on startup if required environment variables are missing,
 * with a clear error message identifying the missing variable.
 *
 * VALIDATION SCOPE:
 * 1. Required Variables:
 *    - `MONGODB_URI`: MongoDB connection string (mongodb:// or mongodb+srv://)
 *    - `FIELD_ENCRYPTION_KEY`: 64-hexadecimal character (256-bit) AES-256-GCM key (NFR-22)
 *    - `TURN_SECRET`: WebRTC voice HMAC credential secret >= 32 characters with >= 12 unique chars (NFR-30)
 *    - RSA JWT Keypair: Accessible, parseable RS256 private and public keys (NFR-11, NFR-17)
 * 2. Conditional Variables:
 *    - `JUDGE0_API_URL` & `JUDGE0_API_KEY`: Required when `EXECUTION_MOCK_MODE !== 'true'`
 * 3. Format & Bounds:
 *    - `PORT`: Integer between 1 and 65535
 *    - `NODE_ENV`: Must be 'development', 'production', or 'test'
 *    - `MONGO_MIN_POOL_SIZE`, `MONGO_MAX_POOL_SIZE`, `MONGO_MAX_IDLE_TIME_MS`: Valid pool bounds (NFR-40)
 *    - `SHUTDOWN_TIMEOUT_MS`: Numeric ms >= 1000 (NFR-38)
 *    - `MAX_WS_PER_ROOM`: Positive integer (NFR-36)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Known insecure / placeholder secret fragments that must never be accepted.
 * @constant {string[]}
 */
const INSECURE_SECRET_PATTERNS = [
  'changeme',
  'placeholder',
  'your-turn-secret',
  'collabide_turn_secret',
  'default-dev',
  'secret-2026',
];

/**
 * Validates the runtime environment against the NFR-49 configuration schema.
 *
 * @function validateEnv
 * @param {object} [env=process.env] - Environment dictionary to validate
 * @param {object} [options={}] - Validation options
 * @param {boolean} [options.exitOnError=true] - Whether to call process.exit(1) on failure
 * @param {object} [options.logger=console] - Logger interface for error output
 * @returns {{ valid: boolean, errors: string[], config: object }} Validation result
 */
function validateEnv(env = process.env, options = {}) {
  const exitOnError = options.exitOnError !== undefined ? options.exitOnError : true;
  const logger = options.logger || console;
  const errors = [];
  const warnings = [];

  // ── 1. Database Connection (MONGODB_URI) ──────────────────────────────────
  const mongoUri = env.MONGODB_URI;
  if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim() === '') {
    errors.push({
      variable: 'MONGODB_URI',
      message: 'Missing required environment variable.',
      description: 'MongoDB connection string (must begin with mongodb:// or mongodb+srv://).',
      example: 'MONGODB_URI="<your-mongodb-connection-uri>" (see .env.example)',
    });
  } else if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
    errors.push({
      variable: 'MONGODB_URI',
      message: 'Invalid MongoDB connection URI format.',
      description: 'URI must start with "mongodb://" or "mongodb+srv://".',
      example: 'MONGODB_URI="<your-mongodb-connection-uri>" (must begin with mongodb:// or mongodb+srv://)',
    });
  }

  // ── 2. Field-Level Encryption Key (FIELD_ENCRYPTION_KEY) ──────────────────
  const encKey = env.FIELD_ENCRYPTION_KEY;
  if (!encKey || typeof encKey !== 'string' || encKey.trim() === '') {
    errors.push({
      variable: 'FIELD_ENCRYPTION_KEY',
      message: 'Missing required environment variable for AES-256-GCM encryption at rest (NFR-22).',
      description: 'Must be a 64-hexadecimal-character string representing a 256-bit cryptographic key.',
      example: 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    });
  } else if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    errors.push({
      variable: 'FIELD_ENCRYPTION_KEY',
      message: `Invalid key length or format (${encKey.length} chars). Must be exactly 64 hexadecimal characters (256 bits).`,
      description: 'Hex string must contain only characters 0-9 and a-f.',
      example: 'FIELD_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"',
    });
  }

  // ── 3. WebRTC Voice Signalling Secret (TURN_SECRET) ───────────────────────
  const turnSecret = env.TURN_SECRET;
  if (!turnSecret || typeof turnSecret !== 'string' || turnSecret.trim() === '') {
    errors.push({
      variable: 'TURN_SECRET',
      message: 'Missing required environment variable for WebRTC voice HMAC credentials (NFR-30).',
      description: 'Must be a cryptographically strong secret string of at least 32 characters.',
      example: 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    });
  } else {
    const trimmedTurn = turnSecret.trim();
    if (trimmedTurn.length < 32) {
      errors.push({
        variable: 'TURN_SECRET',
        message: `TURN_SECRET is too short (${trimmedTurn.length} characters). Minimum required length is 32 characters for HMAC-SHA1 strength.`,
        description: 'Provide a 256-bit secret generated with a CSPRNG.',
        example: 'Generate with: openssl rand -hex 32',
      });
    }

    const lowerTurn = trimmedTurn.toLowerCase();
    const hasInsecurePattern = INSECURE_SECRET_PATTERNS.some((pattern) => lowerTurn.includes(pattern));
    if (hasInsecurePattern) {
      errors.push({
        variable: 'TURN_SECRET',
        message: 'TURN_SECRET contains an insecure placeholder phrase (e.g. "changeme", "placeholder", "default-dev").',
        description: 'Production and staging secrets must be generated with a secure random number generator.',
        example: 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      });
    }

    // Character diversity check (at least 12 distinct characters)
    const uniqueChars = new Set(trimmedTurn).size;
    if (uniqueChars < 12) {
      errors.push({
        variable: 'TURN_SECRET',
        message: `TURN_SECRET has insufficient character diversity (${uniqueChars} unique characters).`,
        description: 'Secret must have sufficient entropy and cannot be a repetitive pattern.',
        example: 'Generate with: openssl rand -hex 32',
      });
    }
  }

  // ── 4. RS256 JWT Asymmetric Keypair Validation ────────────────────────────
  try {
    const { privateKey, publicKey } = resolveJwtKeys(env);
    if (!privateKey || !publicKey) {
      errors.push({
        variable: 'JWT_KEYPAIR',
        message: 'RSA keypair for RS256 JWT signatures could not be resolved.',
        description: 'Provide JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH, or place keys in .keys/private.pem and .keys/public.pem.',
        example: 'Keys can be generated automatically in development via utils/keys.js.',
      });
    } else {
      // Validate roundtrip RS256 sign and verify
      const testPayload = { sub: 'nfr49-startup-check', iat: Math.floor(Date.now() / 1000) };
      const token = jwt.sign(testPayload, privateKey, { algorithm: 'RS256', expiresIn: '60s' });
      const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      if (decoded.sub !== 'nfr49-startup-check') {
        throw new Error('Decoded token subject does not match expected payload.');
      }
    }
  } catch (keyErr) {
    errors.push({
      variable: 'JWT_KEYPAIR',
      message: `RSA RS256 keypair cryptographic validation failed: ${keyErr.message}`,
      description: 'Private and public keys must form a valid, matching RSA keypair for RS256 signatures.',
      example: 'Check that .keys/private.pem and .keys/public.pem are valid PEM files.',
    });
  }

  // ── 5. Server Port (PORT) ─────────────────────────────────────────────────
  let parsedPort = 3000;
  if (env.PORT !== undefined && env.PORT !== '') {
    parsedPort = parseInt(env.PORT, 10);
    if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      errors.push({
        variable: 'PORT',
        message: `Invalid PORT value "${env.PORT}".`,
        description: 'PORT must be an integer between 1 and 65535.',
        example: 'PORT=3000',
      });
    }
  }

  // ── 6. Node Environment (NODE_ENV) ────────────────────────────────────────
  const nodeEnv = env.NODE_ENV || 'development';
  const allowedEnvs = ['development', 'production', 'test'];
  if (!allowedEnvs.includes(nodeEnv)) {
    warnings.push(`NODE_ENV is set to unrecognized value "${nodeEnv}". Expected one of: ${allowedEnvs.join(', ')}.`);
  }

  // ── 7. Remote Code Execution Sandbox (Judge0) ─────────────────────────────
  const isMockExecution = env.EXECUTION_MOCK_MODE === 'true';
  if (!isMockExecution) {
    if (!env.JUDGE0_API_URL || typeof env.JUDGE0_API_URL !== 'string' || env.JUDGE0_API_URL.trim() === '') {
      errors.push({
        variable: 'JUDGE0_API_URL',
        message: 'Missing JUDGE0_API_URL while EXECUTION_MOCK_MODE is false.',
        description: 'Provide Judge0 CE API URL or enable mock mode (EXECUTION_MOCK_MODE=true).',
        example: 'JUDGE0_API_URL="https://judge0-ce.p.rapidapi.com" or self-hosted endpoint',
      });
    } else {
      try {
        new URL(env.JUDGE0_API_URL);
      } catch {
        errors.push({
          variable: 'JUDGE0_API_URL',
          message: `Invalid URL format for JUDGE0_API_URL: "${env.JUDGE0_API_URL}".`,
          description: 'Must be a valid HTTP or HTTPS URL.',
          example: 'JUDGE0_API_URL="https://judge0-ce.p.rapidapi.com"',
        });
      }
    }

    if (!env.JUDGE0_API_KEY || typeof env.JUDGE0_API_KEY !== 'string' || env.JUDGE0_API_KEY.trim() === '') {
      errors.push({
        variable: 'JUDGE0_API_KEY',
        message: 'Missing JUDGE0_API_KEY while EXECUTION_MOCK_MODE is false.',
        description: 'Provide RapidAPI or self-hosted Judge0 API authentication key.',
        example: 'JUDGE0_API_KEY="your-rapidapi-key" or "none" for self-hosted without auth',
      });
    }
  }

  // ── 8. Connection Pooling Parameters (NFR-40) ─────────────────────────────
  let minPool = 5;
  let maxPool = 20;
  let maxIdle = 30000;
  if (env.MONGO_MIN_POOL_SIZE !== undefined && env.MONGO_MIN_POOL_SIZE !== '') {
    minPool = parseInt(env.MONGO_MIN_POOL_SIZE, 10);
    if (isNaN(minPool) || minPool < 0) {
      errors.push({
        variable: 'MONGO_MIN_POOL_SIZE',
        message: `Invalid MONGO_MIN_POOL_SIZE "${env.MONGO_MIN_POOL_SIZE}". Must be a non-negative integer.`,
        description: 'Minimum pre-warmed connection pool size (NFR-40).',
        example: 'MONGO_MIN_POOL_SIZE=5',
      });
    }
  }

  if (env.MONGO_MAX_POOL_SIZE !== undefined && env.MONGO_MAX_POOL_SIZE !== '') {
    maxPool = parseInt(env.MONGO_MAX_POOL_SIZE, 10);
    if (isNaN(maxPool) || maxPool < 1) {
      errors.push({
        variable: 'MONGO_MAX_POOL_SIZE',
        message: `Invalid MONGO_MAX_POOL_SIZE "${env.MONGO_MAX_POOL_SIZE}". Must be an integer >= 1.`,
        description: 'Maximum concurrent connection pool size (NFR-40).',
        example: 'MONGO_MAX_POOL_SIZE=20',
      });
    }
  }

  if (minPool > maxPool) {
    errors.push({
      variable: 'MONGO_POOL_SIZE_BOUNDS',
      message: `MONGO_MIN_POOL_SIZE (${minPool}) cannot exceed MONGO_MAX_POOL_SIZE (${maxPool}).`,
      description: 'Ensure min pool size is less than or equal to max pool size (NFR-40).',
      example: 'MONGO_MIN_POOL_SIZE=5, MONGO_MAX_POOL_SIZE=20',
    });
  }

  if (env.MONGO_MAX_IDLE_TIME_MS !== undefined && env.MONGO_MAX_IDLE_TIME_MS !== '') {
    maxIdle = parseInt(env.MONGO_MAX_IDLE_TIME_MS, 10);
    if (isNaN(maxIdle) || maxIdle < 0) {
      errors.push({
        variable: 'MONGO_MAX_IDLE_TIME_MS',
        message: `Invalid MONGO_MAX_IDLE_TIME_MS "${env.MONGO_MAX_IDLE_TIME_MS}". Must be a non-negative integer.`,
        description: 'Connection idle eviction threshold in milliseconds (NFR-40).',
        example: 'MONGO_MAX_IDLE_TIME_MS=30000',
      });
    }
  }

  // ── 9. Graceful Shutdown Watchdog Timeout (NFR-38) ─────────────────────────
  if (env.SHUTDOWN_TIMEOUT_MS !== undefined && env.SHUTDOWN_TIMEOUT_MS !== '') {
    const timeout = parseInt(env.SHUTDOWN_TIMEOUT_MS, 10);
    if (isNaN(timeout) || timeout < 1000) {
      errors.push({
        variable: 'SHUTDOWN_TIMEOUT_MS',
        message: `Invalid SHUTDOWN_TIMEOUT_MS "${env.SHUTDOWN_TIMEOUT_MS}". Must be an integer >= 1000 ms.`,
        description: 'Watchdog timeout duration for graceful process termination (NFR-38).',
        example: 'SHUTDOWN_TIMEOUT_MS=10000',
      });
    }
  }

  // ── 10. WebSocket Room Limit (NFR-36) ──────────────────────────────────────
  if (env.MAX_WS_PER_ROOM !== undefined && env.MAX_WS_PER_ROOM !== '') {
    const wsLimit = parseInt(env.MAX_WS_PER_ROOM, 10);
    if (isNaN(wsLimit) || wsLimit < 1) {
      errors.push({
        variable: 'MAX_WS_PER_ROOM',
        message: `Invalid MAX_WS_PER_ROOM "${env.MAX_WS_PER_ROOM}". Must be an integer >= 1.`,
        description: 'Per-room WebSocket concurrency cap (NFR-36).',
        example: 'MAX_WS_PER_ROOM=20',
      });
    }
  }

  // ── Multi-Error Formatting & Fail-Fast Output ──────────────────────────────
  const isValid = errors.length === 0;

  if (!isValid) {
    const errorBanner = formatErrorBanner(errors);
    logger.error(errorBanner);

    if (exitOnError) {
      logger.error('❌ Exiting process immediately (NFR-49 fail-fast startup guard).\n');
      process.exit(1);
    }
  }

  if (warnings.length > 0 && isValid) {
    warnings.forEach((warn) => logger.warn(`⚠️  [ENV WARNING]: ${warn}`));
  }

  return {
    valid: isValid,
    errors,
    warnings,
    config: {
      port: parsedPort,
      nodeEnv,
      mongoUri,
      isMockExecution,
      pool: { minPoolSize: minPool, maxPoolSize: maxPool, maxIdleTimeMS: maxIdle },
    },
  };
}

/**
 * Resolves RSA JWT keypair from environment paths, env variables, or default directory.
 *
 * @private
 * @param {object} env - Environment dictionary
 * @returns {{ privateKey: string, publicKey: string }}
 */
function resolveJwtKeys(env) {
  // 1. Direct PEM strings in environment
  if (env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY) {
    return {
      privateKey: env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      publicKey: env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
    };
  }

  // 2. Custom file paths from environment
  const privPath = env.JWT_PRIVATE_KEY_PATH || path.join(__dirname, '..', '.keys', 'private.pem');
  const pubPath = env.JWT_PUBLIC_KEY_PATH || path.join(__dirname, '..', '.keys', 'public.pem');

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    return {
      privateKey: fs.readFileSync(privPath, 'utf8'),
      publicKey: fs.readFileSync(pubPath, 'utf8'),
    };
  }

  // 3. Fallback to existing utils/keys loader
  const keysUtil = require('../utils/keys');
  if (keysUtil && keysUtil.privateKey && keysUtil.publicKey) {
    return {
      privateKey: keysUtil.privateKey,
      publicKey: keysUtil.publicKey,
    };
  }

  return { privateKey: null, publicKey: null };
}

/**
 * Formats a high-visibility diagnostic banner listing all configuration errors.
 *
 * @private
 * @param {Array<{ variable: string, message: string, description: string, example: string }>} errors
 * @returns {string} Formatted error box
 */
function formatErrorBanner(errors) {
  const line = '═'.repeat(78);
  const border = '─'.repeat(78);

  const errorItems = errors
    .map((err, idx) => {
      return (
        `  ${idx + 1}. [${err.variable}]\n` +
        `     ✖ Error:       ${err.message}\n` +
        `     ℹ Description: ${err.description}\n` +
        `     ✔ Resolution:  ${err.example}`
      );
    })
    .join('\n\n');

  return (
    `\n╔${line}╗\n` +
    `║ ❌ FATAL CONFIGURATION ERROR: Invalid or Missing Environment Variables (NFR-49) ║\n` +
    `╚${line}╝\n\n` +
    `The application cannot start because ${errors.length} configuration error(s) were found:\n\n` +
    `${errorItems}\n\n` +
    `┌${border}┐\n` +
    `│ ACTION REQUIRED:                                                             │\n` +
    `│ 1. Configure the missing variables in your .env file or cloud secrets manager.│\n` +
    `│ 2. Refer to .env.example for variable templates and cryptographic generation. │\n` +
    `└${border}┘\n`
  );
}

module.exports = {
  validateEnv,
  formatErrorBanner,
  INSECURE_SECRET_PATTERNS,
};
