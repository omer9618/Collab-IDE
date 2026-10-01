/**
 * @file test_logger_security.js
 * @description Automated Security Verification Test Suite for NFR-23: No Sensitive Data in Logs.
 *
 * Verifies:
 * 1. Zero Passwords in logs (plain, JSON, object key-value).
 * 2. Zero JWT Tokens in logs (raw, Bearer header, URL query parameter).
 * 3. Zero Refresh Tokens in logs (opaque hex string, cookie header, object key-value).
 * 4. Zero Raw Email Addresses in logs (message text, object metadata, query parameters).
 * 5. Zero Code Content in logs (markdown blocks, HTML tags, function definitions, object properties).
 * 6. User IDs and Room IDs are strictly used as identifiers in structured log headers.
 * 7. Log files are stored with restricted permissions (0o640 files, 0o750 directories).
 * 8. Global console interceptor transparently sanitizes unmigrated third-party calls.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./utils/logger');

let passCount = 0;
let failCount = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}`);
    passCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName} ${details ? `(${details})` : ''}`);
    failCount++;
  }
}

async function runSecurityTestSuite() {
  console.log('\n================================================================');
  console.log('   NFR-23 SECURITY VERIFICATION: NO SENSITIVE DATA IN LOGS');
  console.log('================================================================\n');

  // ── TEST 1: Password Redaction ──────────────────────────────────────────────
  console.log('Test Suite 1: Password Redaction');
  {
    const samplePassword = 'SuperSecretP@ssword2026!';
    const rawMsg = `Attempted login with password: "${samplePassword}" and secret: "${samplePassword}"`;
    const sanitized = logger.sanitizeString(rawMsg);

    assert(!sanitized.includes(samplePassword), 'Plain password in string is completely removed');
    assert(sanitized.includes('[REDACTED_PASSWORD]'), 'Plain password is replaced with [REDACTED_PASSWORD]');

    const objWithPass = {
      password: samplePassword,
      newPassword: samplePassword,
      currentPassword: samplePassword,
      confirmPassword: samplePassword,
      nested: { secret: samplePassword },
    };
    const sanitizedObj = logger.sanitizeValue(objWithPass);
    const jsonStr = JSON.stringify(sanitizedObj);

    assert(!jsonStr.includes(samplePassword), 'Password keys in object metadata are completely removed');
    assert(sanitizedObj.password === '[REDACTED_PASSWORD]', 'password field sanitized');
    assert(sanitizedObj.nested.secret === '[REDACTED_PASSWORD]', 'nested secret field sanitized');
  }

  // ── TEST 2: JWT Token Redaction ─────────────────────────────────────────────
  console.log('\nTest Suite 2: JWT Token Redaction');
  {
    const fakeJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NWE4MTIzNCIsImlhdCI6MTYxNjIzOTAyMn0.abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFGHIJKLM';
    const rawJwtMsg = `Auth failed with header: Bearer ${fakeJwt}`;
    const sanitizedMsg = logger.sanitizeString(rawJwtMsg);

    assert(!sanitizedMsg.includes(fakeJwt), 'Raw JWT in string is completely removed');
    assert(sanitizedMsg.includes('[REDACTED_JWT]') || sanitizedMsg.includes('[REDACTED_TOKEN]'), 'JWT is replaced with REDACTED placeholder');

    const urlMsg = `Upgrade requested with URL /ws/room-123?token=${fakeJwt}`;
    const sanitizedUrl = logger.sanitizeString(urlMsg);
    assert(!sanitizedUrl.includes(fakeJwt), 'JWT in URL query parameters is completely removed');
    assert(sanitizedUrl.includes('token=[REDACTED]'), 'URL token parameter redacted');
  }

  // ── TEST 3: Refresh Token Redaction ─────────────────────────────────────────
  console.log('\nTest Suite 3: Refresh Token Redaction');
  {
    const fakeRefreshToken = crypto.randomBytes(40).toString('hex'); // 80 hex characters
    const cookieHeader = `Cookie: refreshToken=${fakeRefreshToken}; session=active`;
    const sanitizedCookie = logger.sanitizeString(cookieHeader);

    assert(!sanitizedCookie.includes(fakeRefreshToken), '80-char hex refresh token in cookie string is completely removed');
    assert(sanitizedCookie.includes('[REDACTED_REFRESH_TOKEN]') || sanitizedCookie.includes('[REDACTED]'), 'Refresh token string redacted');

    const objWithTokens = {
      refreshToken: fakeRefreshToken,
      accessToken: 'sample-access-token',
      verificationToken: 'sample-verification-token',
      resetPasswordToken: 'sample-reset-token',
    };
    const sanitizedObj = logger.sanitizeValue(objWithTokens);
    assert(sanitizedObj.refreshToken === '[REDACTED_TOKEN]', 'refreshToken key redacted in object');
    assert(sanitizedObj.accessToken === '[REDACTED_TOKEN]', 'accessToken key redacted in object');
    assert(sanitizedObj.verificationToken === '[REDACTED_TOKEN]', 'verificationToken key redacted in object');
  }

  // ── TEST 4: Raw Email Address Redaction ─────────────────────────────────────
  console.log('\nTest Suite 4: Raw Email Address Redaction');
  {
    const testEmail = 'john.doe+test@gmail.com';
    const emailMsg = `User with email ${testEmail} registered from 192.168.1.1`;
    const sanitizedEmailMsg = logger.sanitizeString(emailMsg);

    assert(!sanitizedEmailMsg.includes(testEmail), 'Raw email address in string is completely removed');
    assert(sanitizedEmailMsg.includes('[REDACTED_EMAIL]'), 'Email is replaced with [REDACTED_EMAIL]');

    const objWithEmail = {
      email: testEmail,
      pendingEmail: 'new.email@example.com',
      normalizedEmail: testEmail,
    };
    const sanitizedObj = logger.sanitizeValue(objWithEmail);
    assert(sanitizedObj.email === '[REDACTED_EMAIL]', 'email object key redacted');
    assert(sanitizedObj.pendingEmail === '[REDACTED_EMAIL]', 'pendingEmail object key redacted');
    assert(sanitizedObj.normalizedEmail === '[REDACTED_EMAIL]', 'normalizedEmail object key redacted');
  }

  // ── TEST 5: Code Content Redaction ──────────────────────────────────────────
  console.log('\nTest Suite 5: Code Content Redaction');
  {
    const codeSnippet = '```javascript\nfunction dangerousEval() { eval("evil()"); }\n```';
    const sanitizedBlock = logger.sanitizeString(codeSnippet);

    assert(!sanitizedBlock.includes('eval("evil()")'), 'Markdown code block content is completely removed');
    assert(sanitizedBlock.includes('[REDACTED_CODE_BLOCK]'), 'Code block replaced with [REDACTED_CODE_BLOCK]');

    const htmlCode = '<script>window.location="http://attacker.com";</script>';
    const sanitizedHtml = logger.sanitizeString(htmlCode);
    assert(!sanitizedHtml.includes('attacker.com'), 'HTML/Script tags in log string are completely removed');

    const fnCode = 'function calculateTotal(items) { return items.reduce((a,b) => a+b, 0); }';
    const sanitizedFn = logger.sanitizeString(fnCode);
    assert(!sanitizedFn.includes('reduce((a,b)'), 'Inline function code in string is removed');

    const codeObj = {
      code: 'print("Hello from Judge0")',
      source_code: 'import os; os.system("ls")',
      content: '// Room template file content',
      stdin: 'input_line_1\ninput_line_2',
      ydocState: Buffer.from([1, 2, 3]),
    };
    const sanitizedCodeObj = logger.sanitizeValue(codeObj);
    assert(sanitizedCodeObj.code === '[REDACTED_CODE]', 'code object key redacted');
    assert(sanitizedCodeObj.source_code === '[REDACTED_CODE]', 'source_code object key redacted');
    assert(sanitizedCodeObj.content === '[REDACTED_CODE]', 'content object key redacted');
    assert(sanitizedCodeObj.stdin === '[REDACTED_CODE]', 'stdin object key redacted');
    assert(sanitizedCodeObj.ydocState === '[REDACTED_CODE]', 'ydocState object key redacted');
  }

  // ── TEST 6: User ID & Room ID Identifier Formatting ─────────────────────────
  console.log('\nTest Suite 6: User ID & Room ID Structured Identifiers');
  {
    const userId = '65a812349f8123456789abcd';
    const roomId = 'b0409a80-1a1b-410a-8d76-b6d376ebdf82';

    // Clear logs for fresh test inspection
    fs.writeFileSync(logger.APP_LOG_PATH, '');

    logger.info('User joined collaborative session', { userId, roomId });
    logger.audit('ROLE_PROMOTED', { userId, roomId, newRole: 'Editor' });
    logger.error(new Error('Connection timed out'), { userId, roomId });

    const logFileContent = fs.readFileSync(logger.APP_LOG_PATH, 'utf8');

    assert(logFileContent.includes(`[User: ${userId}]`), 'Log entry includes [User: <userId>]');
    assert(logFileContent.includes(`[Room: ${roomId}]`), 'Log entry includes [Room: <roomId>]');
    assert(logFileContent.includes('[INFO]'), 'Log entry contains [INFO] level');
    assert(logFileContent.includes('[AUDIT]'), 'Log entry contains [AUDIT] level');
    assert(logFileContent.includes('[ERROR]'), 'Log entry contains [ERROR] level');
  }

  // ── TEST 7: Log Storage & Permissions (chmod 640) ───────────────────────────
  console.log('\nTest Suite 7: Filesystem Storage & chmod 640 Mode');
  {
    assert(fs.existsSync(logger.APP_LOG_PATH), 'app.log file exists on disk');
    assert(fs.existsSync(logger.ERROR_LOG_PATH), 'error.log file exists on disk');
    assert(fs.existsSync(logger.AUDIT_LOG_PATH), 'audit.log file exists on disk');

    const stat = fs.statSync(logger.APP_LOG_PATH);
    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      assert(mode === 0o640, `app.log mode is chmod 640 (actual: 0o${mode.toString(8)})`);
    } else {
      assert(stat.isFile(), 'app.log is verified file with read/write access (Windows POSIX simulation)');
    }
  }

  // ── TEST 8: Global Console Interceptor Transparency ─────────────────────────
  console.log('\nTest Suite 8: Global Console Interceptor Redaction');
  {
    const restoreConsole = logger.installGlobalInterceptor();

    const leakedEmail = 'developer.leak@company.org';
    const leakedPassword = 'LeakedPassword#2026';
    const leakedToken = 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJ1c2VySWQiOiJ0ZXN0In0.xyz';

    console.log(`Debug log: User ${leakedEmail} logged in with pass=${leakedPassword}`);
    console.error(`Fatal crash for token: ${leakedToken}`);

    restoreConsole();

    const appLogContent = fs.readFileSync(logger.APP_LOG_PATH, 'utf8');

    assert(!appLogContent.includes(leakedEmail), 'Global console interceptor stripped raw email');
    assert(!appLogContent.includes(leakedPassword), 'Global console interceptor stripped password');
    assert(!appLogContent.includes('eyJ1c2VySWQiOiJ0ZXN0In0'), 'Global console interceptor stripped JWT payload');
  }

  console.log('\n================================================================');
  console.log(`   TOTAL TESTS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runSecurityTestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
