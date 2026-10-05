/**
 * @file test/test_nfr49_env_config.js
 * @description Comprehensive Automated Verification Suite for NFR-49: Environment-Based Configuration.
 *
 * Verifies:
 * 1. Schema Validation Unit Tests (required vars, format checks, entropy, multi-error accumulation)
 * 2. Fail-Fast Process Startup Guard (child process exit code 1, stderr diagnostic output)
 * 3. Repo-Wide Static Analysis Vulnerability Sweep (no hardcoded Mongo URIs, OAuth IDs, Judge0 hosts, RapidAPI keys, secret fallbacks)
 * 4. Key Rotation Utility Unit & Cryptographic Invariants (HKDF derivation, GCM auth tag check, blind index math, idempotency)
 * 5. Production PM2 & Render Deployment Hardening (crash loop limits, sync: false secrets, .env.example placeholders)
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { validateEnv, formatErrorBanner, INSECURE_SECRET_PATTERNS } = require('../config/env');
const {
  rotateEncryptionKeys,
  deriveKeys,
  parseKey,
  tryDecrypt,
  encryptWithKey,
  hashBlindIndexWithKey,
} = require('../scripts/rotate_encryption_key');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function check(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}`);
    passedTests++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName} ${details ? `(${details})` : ''}`);
    failedTests++;
  }
}

/**
 * Returns a valid base mock environment for testing.
 */
function createValidMockEnv() {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    MONGODB_URI: 'mongodb+srv://testuser:testpass@cluster0.example.mongodb.net/testdb?retryWrites=true&w=majority',
    FIELD_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    TURN_SECRET: crypto.randomBytes(32).toString('hex'),
    EXECUTION_MOCK_MODE: 'true',
    MONGO_MIN_POOL_SIZE: '5',
    MONGO_MAX_POOL_SIZE: '20',
    MONGO_MAX_IDLE_TIME_MS: '30000',
    SHUTDOWN_TIMEOUT_MS: '10000',
    MAX_WS_PER_ROOM: '20',
  };
}

async function runTestSuite() {
  console.log('\n================================================================');
  console.log('   NFR-49 VERIFICATION: ENVIRONMENT-BASED CONFIGURATION SUITE   ');
  console.log('================================================================\n');

  const silentLogger = {
    error: () => {},
    warn: () => {},
    log: () => {},
  };

  // ── SUITE 1: Schema Validation Unit Tests ──────────────────────────────────
  console.log('Test Suite 1: Schema Validation Unit Tests');
  {
    // 1.1 Complete valid environment passes
    const validEnv = createValidMockEnv();
    const result1 = validateEnv(validEnv, { exitOnError: false, logger: silentLogger });
    check(result1.valid === true, 'Valid environment passes schema validation');
    check(result1.errors.length === 0, 'Valid environment produces 0 errors');
    check(result1.config.port === 3000, 'Config object correctly parses port as integer');

    // 1.2 Missing MONGODB_URI
    const noMongo = createValidMockEnv();
    delete noMongo.MONGODB_URI;
    const result2 = validateEnv(noMongo, { exitOnError: false, logger: silentLogger });
    check(result2.valid === false, 'Missing MONGODB_URI fails validation');
    check(result2.errors.some((e) => e.variable === 'MONGODB_URI'), 'Error lists MONGODB_URI');

    // 1.3 Invalid MONGODB_URI format
    const badMongo = createValidMockEnv();
    badMongo.MONGODB_URI = 'postgres://user:pass@localhost:5432/db';
    const result3 = validateEnv(badMongo, { exitOnError: false, logger: silentLogger });
    check(result3.valid === false, 'Invalid URI scheme fails validation');
    check(result3.errors.some((e) => e.variable === 'MONGODB_URI' && e.message.includes('format')), 'Error explains URI format requirement');

    // 1.4 Missing FIELD_ENCRYPTION_KEY
    const noKey = createValidMockEnv();
    delete noKey.FIELD_ENCRYPTION_KEY;
    const result4 = validateEnv(noKey, { exitOnError: false, logger: silentLogger });
    check(result4.valid === false, 'Missing FIELD_ENCRYPTION_KEY fails validation');
    check(result4.errors.some((e) => e.variable === 'FIELD_ENCRYPTION_KEY'), 'Error lists FIELD_ENCRYPTION_KEY');

    // 1.5 Invalid FIELD_ENCRYPTION_KEY length (not 64 hex chars)
    const shortKey = createValidMockEnv();
    shortKey.FIELD_ENCRYPTION_KEY = '0123456789abcdef'; // 16 chars
    const result5 = validateEnv(shortKey, { exitOnError: false, logger: silentLogger });
    check(result5.valid === false, '16-character FIELD_ENCRYPTION_KEY is rejected');
    check(result5.errors.some((e) => e.variable === 'FIELD_ENCRYPTION_KEY' && e.message.includes('64')), 'Error requires exactly 64 hex characters');

    // 1.6 Non-hex FIELD_ENCRYPTION_KEY
    const nonHexKey = createValidMockEnv();
    nonHexKey.FIELD_ENCRYPTION_KEY = 'z'.repeat(64);
    const result6 = validateEnv(nonHexKey, { exitOnError: false, logger: silentLogger });
    check(result6.valid === false, 'Non-hex FIELD_ENCRYPTION_KEY is rejected');

    // 1.7 Missing TURN_SECRET
    const noTurn = createValidMockEnv();
    delete noTurn.TURN_SECRET;
    const result7 = validateEnv(noTurn, { exitOnError: false, logger: silentLogger });
    check(result7.valid === false, 'Missing TURN_SECRET fails validation');
    check(result7.errors.some((e) => e.variable === 'TURN_SECRET'), 'Error lists TURN_SECRET');

    // 1.8 TURN_SECRET too short (< 32 chars)
    const shortTurn = createValidMockEnv();
    shortTurn.TURN_SECRET = 'short-secret-15';
    const result8 = validateEnv(shortTurn, { exitOnError: false, logger: silentLogger });
    check(result8.valid === false, 'TURN_SECRET < 32 characters is rejected');
    check(result8.errors.some((e) => e.variable === 'TURN_SECRET' && e.message.includes('32')), 'Error specifies 32-character floor');

    // 1.9 TURN_SECRET contains placeholder substring
    const placeholderTurn = createValidMockEnv();
    placeholderTurn.TURN_SECRET = 'my-super-secret-collabide-turn-changeme-2026';
    const result9 = validateEnv(placeholderTurn, { exitOnError: false, logger: silentLogger });
    check(result9.valid === false, 'TURN_SECRET with placeholder substring is rejected');
    check(result9.errors.some((e) => e.variable === 'TURN_SECRET' && e.message.includes('placeholder')), 'Error flags placeholder phrase');

    // 1.10 TURN_SECRET with low character diversity (< 12 distinct chars)
    const lowDivTurn = createValidMockEnv();
    lowDivTurn.TURN_SECRET = 'a'.repeat(35); // 35 chars, only 1 unique char
    const result10 = validateEnv(lowDivTurn, { exitOnError: false, logger: silentLogger });
    check(result10.valid === false, 'TURN_SECRET with low character diversity is rejected');
    check(result10.errors.some((e) => e.variable === 'TURN_SECRET' && e.message.includes('diversity')), 'Error flags insufficient character diversity');

    // 1.11 Multi-error accumulation: reports all missing required variables at once
    const emptyEnv = {};
    const multiResult = validateEnv(emptyEnv, { exitOnError: false, logger: silentLogger });
    check(multiResult.valid === false, 'Empty environment fails validation');
    check(multiResult.errors.length >= 4, `Accumulates all missing variables in one pass (${multiResult.errors.length} errors found)`);
    const errorVariables = multiResult.errors.map((e) => e.variable);
    check(errorVariables.includes('MONGODB_URI'), 'Multi-error lists MONGODB_URI');
    check(errorVariables.includes('FIELD_ENCRYPTION_KEY'), 'Multi-error lists FIELD_ENCRYPTION_KEY');
    check(errorVariables.includes('TURN_SECRET'), 'Multi-error lists TURN_SECRET');

    // 1.12 Error banner generation
    const banner = formatErrorBanner(multiResult.errors);
    check(typeof banner === 'string' && banner.includes('FATAL CONFIGURATION ERROR'), 'Banner contains prominent header');
    check(banner.includes('ACTION REQUIRED'), 'Banner contains actionable remediation guidance');

    // 1.13 Judge0 conditional requirement when EXECUTION_MOCK_MODE=false
    const judge0Env = createValidMockEnv();
    judge0Env.EXECUTION_MOCK_MODE = 'false';
    delete judge0Env.JUDGE0_API_URL;
    delete judge0Env.JUDGE0_API_KEY;
    const judge0Result = validateEnv(judge0Env, { exitOnError: false, logger: silentLogger });
    check(judge0Result.valid === false, 'Missing Judge0 credentials when EXECUTION_MOCK_MODE=false is rejected');
    check(judge0Result.errors.some((e) => e.variable === 'JUDGE0_API_URL'), 'Flags missing JUDGE0_API_URL');
    check(judge0Result.errors.some((e) => e.variable === 'JUDGE0_API_KEY'), 'Flags missing JUDGE0_API_KEY');

    // 1.14 Numeric bounds validation (PORT, Pool, Timeout)
    const boundsEnv = createValidMockEnv();
    boundsEnv.PORT = '999999';
    boundsEnv.MONGO_MIN_POOL_SIZE = '50';
    boundsEnv.MONGO_MAX_POOL_SIZE = '10'; // min > max
    boundsEnv.SHUTDOWN_TIMEOUT_MS = '100'; // < 1000
    const boundsResult = validateEnv(boundsEnv, { exitOnError: false, logger: silentLogger });
    check(boundsResult.errors.some((e) => e.variable === 'PORT'), 'Port > 65535 is rejected');
    check(boundsResult.errors.some((e) => e.variable === 'MONGO_POOL_SIZE_BOUNDS'), 'Min pool > max pool is rejected');
    check(boundsResult.errors.some((e) => e.variable === 'SHUTDOWN_TIMEOUT_MS'), 'Timeout < 1000ms is rejected');
  }

  // ── SUITE 2: Subprocess Fail-Fast Startup Verification ─────────────────────
  console.log('\nTest Suite 2: Subprocess Fail-Fast Startup Verification');
  {
    // 2.1 Child process with missing environment exits with code 1
    const child1 = cp.spawnSync(
      process.execPath,
      ['-e', "require('./server.js');"],
      {
        cwd: path.join(__dirname, '..'),
        env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, NODE_ENV: 'test', SKIP_DOTENV: 'true' }, // Stripped env
        encoding: 'utf8',
        timeout: 5000,
      }
    );
    check(child1.status === 1, `Subprocess with missing env exits with code 1 (received: ${child1.status})`);
    const output1 = (child1.stderr || '') + (child1.stdout || '');
    check(output1.includes('FATAL CONFIGURATION ERROR'), 'Subprocess output contains FATAL CONFIGURATION ERROR banner');
    check(output1.includes('NFR-49 fail-fast startup guard'), 'Subprocess output mentions NFR-49 fail-fast guard');

    // 2.2 Subprocess with missing FIELD_ENCRYPTION_KEY specifically
    const child2 = cp.spawnSync(
      process.execPath,
      ['-e', "require('./server.js');"],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          NODE_ENV: 'test',
          SKIP_DOTENV: 'true',
          MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
          TURN_SECRET: crypto.randomBytes(32).toString('hex'),
          EXECUTION_MOCK_MODE: 'true',
          // FIELD_ENCRYPTION_KEY omitted
        },
        encoding: 'utf8',
        timeout: 5000,
      }
    );
    check(child2.status === 1, 'Subprocess with missing FIELD_ENCRYPTION_KEY exits with code 1');
    const output2 = (child2.stderr || '') + (child2.stdout || '');
    check(output2.includes('FIELD_ENCRYPTION_KEY'), 'Subprocess error identifies FIELD_ENCRYPTION_KEY');
  }

  // ── SUITE 3: Repo-Wide Static Analysis Vulnerability Sweep ─────────────────
  console.log('\nTest Suite 3: Repo-Wide Static Analysis Vulnerability Sweep');
  {
    const rootDir = path.join(__dirname, '..');
    const jsFiles = [];

    function findJsFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Exclude node_modules, test directories, and .keys
          if (
            entry.name === 'node_modules' ||
            entry.name === 'test' ||
            entry.name === '.keys' ||
            entry.name === 'logs' ||
            entry.name === '.git'
          ) {
            continue;
          }
          findJsFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          // Exclude generated bundle in public/
          if (entry.name === 'collab-bundle.js') continue;
          jsFiles.push(fullPath);
        }
      }
    }

    findJsFiles(rootDir);
    check(jsFiles.length >= 10, `Static analysis discovered ${jsFiles.length} application JS source files`);

    const violations = {
      mongoUri: [],
      googleClientId: [],
      judge0Host: [],
      rapidApiKey: [],
      placeholderSecrets: [],
    };

    // Generic vulnerability patterns (no leaked secret fragments)
    const REGEX_MONGO_URI = /['"`]mongodb(?:\+srv)?:\/\/[^'"`\s]+['"`]/g;
    const REGEX_GOOGLE_CLIENT = /['"`][0-9a-zA-Z._-]+@developer\.gserviceaccount\.com['"`]|['"`][0-9a-zA-Z._-]+\.apps\.googleusercontent\.com['"`]/g;
    const REGEX_JUDGE0_HOST = /['"`]judge0-ce\.p\.rapidapi\.com['"`]/g;
    const REGEX_GENERIC_RAPIDAPI_KEY = /(?:rapidapi|judge0)[_-]?key\s*[:=]\s*['"][a-zA-Z0-9]{40,60}['"]/i;
    const REGEX_PLACEHOLDER_SECRETS = /['"`](?:collabide_turn_secret|collabide-default-dev-field-encryption-key-2026)['"`]/g;

    for (const filePath of jsFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const relative = path.relative(rootDir, filePath);

      // config/env.js defines the security blacklist of rejected patterns
      const isEnvValidator = relative === 'config/env.js' || relative === 'config\\env.js';

      if (REGEX_MONGO_URI.test(content)) violations.mongoUri.push(relative);
      if (REGEX_GOOGLE_CLIENT.test(content)) violations.googleClientId.push(relative);
      if (REGEX_JUDGE0_HOST.test(content)) violations.judge0Host.push(relative);
      if (REGEX_GENERIC_RAPIDAPI_KEY.test(content)) violations.rapidApiKey.push(relative);
      if (!isEnvValidator && REGEX_PLACEHOLDER_SECRETS.test(content)) violations.placeholderSecrets.push(relative);
    }

    check(violations.mongoUri.length === 0, 'No hardcoded MongoDB connection URIs in JS source files', violations.mongoUri.join(', '));
    check(violations.googleClientId.length === 0, 'No hardcoded Google OAuth client IDs in JS source files', violations.googleClientId.join(', '));
    check(violations.judge0Host.length === 0, 'No hardcoded judge0-ce.p.rapidapi.com Host headers in JS source files', violations.judge0Host.join(', '));
    check(violations.rapidApiKey.length === 0, 'No hardcoded RapidAPI key literals in JS source files', violations.rapidApiKey.join(', '));
    check(violations.placeholderSecrets.length === 0, 'No hardcoded placeholder secrets in JS source files', violations.placeholderSecrets.join(', '));
  }

  // ── SUITE 4: Key Rotation Utility & Cryptographic Invariants ───────────────
  console.log('\nTest Suite 4: Key Rotation Utility & Cryptographic Invariants');
  {
    const testKey1 = crypto.randomBytes(32).toString('hex');
    const testKey2 = crypto.randomBytes(32).toString('hex');

    // 4.1 parseKey function
    const masterBuf1 = parseKey(testKey1);
    check(masterBuf1.length === 32, 'parseKey produces exact 32-byte Buffer from 64-hex string');

    // 4.2 deriveKeys function
    const derived1 = deriveKeys(masterBuf1);
    check(Buffer.isBuffer(derived1.cipherKey) && derived1.cipherKey.length === 32, 'deriveKeys produces 32-byte AES cipher key');
    check(Buffer.isBuffer(derived1.indexKey) && derived1.indexKey.length === 32, 'deriveKeys produces 32-byte HMAC index key');
    check(!derived1.cipherKey.equals(derived1.indexKey), 'HKDF guarantees cipherKey and indexKey are cryptographically distinct');

    // 4.3 Roundtrip encryption and decryption
    const sampleEmail = 'researcher.lead@collabide.dev';
    const ciphertext1 = encryptWithKey(sampleEmail, derived1.cipherKey);
    check(typeof ciphertext1 === 'string' && ciphertext1.startsWith('enc:gcm:'), 'encryptWithKey produces enc:gcm:* payload');
    const decrypted1 = tryDecrypt(ciphertext1, derived1.cipherKey);
    check(decrypted1 === sampleEmail, 'tryDecrypt recovers exact original plaintext with matching key');

    // 4.4 Decryption failure with wrong key (GCM authentication tag check)
    const masterBuf2 = parseKey(testKey2);
    const derived2 = deriveKeys(masterBuf2);
    const wrongDecrypt = tryDecrypt(ciphertext1, derived2.cipherKey);
    check(wrongDecrypt === null, 'tryDecrypt returns null when attempting to decrypt with non-matching key');

    // 4.5 Blind index determinism and distinctness
    const indexHash1 = hashBlindIndexWithKey(sampleEmail, derived1.indexKey);
    const indexHash2 = hashBlindIndexWithKey(sampleEmail, derived2.indexKey);
    check(indexHash1.length === 64, 'hashBlindIndex produces 64-character hex hash');
    check(indexHash1 !== indexHash2, 'Different master keys produce distinct blind index hashes for same plaintext');

    // 4.6 Verification that rotateEncryptionKeys exports correctly
    check(typeof rotateEncryptionKeys === 'function', 'scripts/rotate_encryption_key exports rotateEncryptionKeys function');
  }

  // ── SUITE 5: PM2 Crash Protection & Deployment Hardening ───────────────────
  console.log('\nTest Suite 5: PM2 Configuration & Deployment Hardening');
  {
    // 5.1 ecosystem.config.js checks
    const ecosystemPath = path.join(__dirname, '..', 'ecosystem.config.js');
    check(fs.existsSync(ecosystemPath), 'ecosystem.config.js exists');
    const ecosystem = require(ecosystemPath);
    const appConfig = ecosystem.apps[0];

    check(appConfig.min_uptime === 5000, `ecosystem.config.js configures min_uptime: 5000 (actual: ${appConfig.min_uptime})`);
    check(appConfig.max_restarts === 3, `ecosystem.config.js configures max_restarts: 3 (actual: ${appConfig.max_restarts})`);
    check(Boolean(appConfig.exp_backoff_restart_delay), 'ecosystem.config.js configures exponential backoff delay');

    // 5.2 render.yaml sanitization checks
    const renderPath = path.join(__dirname, '..', '..', 'render.yaml');
    check(fs.existsSync(renderPath), 'render.yaml exists in repository root');
    const renderContent = fs.readFileSync(renderPath, 'utf8').replace(/\r\n/g, '\n');

    check(!renderContent.includes('omerdb9090'), 'render.yaml contains NO database password');
    check(!renderContent.includes('16017cdd07msh'), 'render.yaml contains NO RapidAPI key');
    check(renderContent.includes('key: MONGODB_URI\n        sync: false'), 'render.yaml marks MONGODB_URI with sync: false');
    check(renderContent.includes('key: FIELD_ENCRYPTION_KEY\n        sync: false'), 'render.yaml marks FIELD_ENCRYPTION_KEY with sync: false');
    check(renderContent.includes('key: TURN_SECRET\n        sync: false'), 'render.yaml marks TURN_SECRET with sync: false');
    check(renderContent.includes('key: JUDGE0_API_KEY\n        sync: false'), 'render.yaml marks JUDGE0_API_KEY with sync: false');
    check(renderContent.includes('SECURITY NOTICE'), 'render.yaml includes historical security rotation notice');

    // 5.3 .env.example placeholder checks
    const examplePath = path.join(__dirname, '..', '.env.example');
    check(fs.existsSync(examplePath), '.env.example exists');
    const exampleContent = fs.readFileSync(examplePath, 'utf8');

    check(!exampleContent.includes('omerdb9090'), '.env.example contains NO database credentials');
    check(!exampleContent.includes('16017cdd07msh'), '.env.example contains NO real RapidAPI key');
    check(exampleContent.includes('FIELD_ENCRYPTION_KEY=<'), '.env.example uses non-working placeholder for FIELD_ENCRYPTION_KEY');
    check(exampleContent.includes('TURN_SECRET=<'), '.env.example uses non-working placeholder for TURN_SECRET');
    check(exampleContent.includes('crypto.randomBytes(32).toString(\'hex\')'), '.env.example documents CSPRNG command for secret generation');

    // 5.4 modules/infrastructure exports env
    const { infrastructure } = require('../modules');
    check(Boolean(infrastructure.config), 'modules/infrastructure exports config');
    check(typeof infrastructure.config.validateEnv === 'function', 'infrastructure.config exports validateEnv');
  }

  // ── FINAL SUMMARY ──────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`   TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    console.error(`❌ Verification failed with ${failedTests} failure(s).`);
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-49 ENVIRONMENT-BASED CONFIGURATION REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ Unhandled error in NFR-49 test suite:', err);
  process.exit(1);
});
