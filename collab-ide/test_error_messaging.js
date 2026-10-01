/**
 * @file test_error_messaging.js
 * @description Automated Verification Test Suite for NFR-47: Error Messaging.
 *
 * Requirements Verified:
 * 1. Plain English messages across all error conditions.
 * 2. Zero exposure of internal error codes (E11000, ECONNREFUSED, CastError, MongoServerError).
 * 3. Zero exposure of stack traces ('at Function.run (...)', line numbers).
 * 4. Zero exposure of filesystem paths ('C:\...', '/var/www/...', '/home/...').
 * 5. Zero exposure of internal database identifiers (ObjectId, collection names, index names).
 * 6. Express middleware sanitization (404 unknown routes, 400 malformed JSON, 500 uncaught exceptions).
 * 7. End-to-end HTTP integration assertions against real endpoints.
 * 8. Client-side formatErrorMessage sanitization for network errors, popup aborts, and technical errors.
 */

require('dotenv').config();
const http = require('http');
const {
  containsTechnicalJargon,
  sanitizeErrorToPlainEnglish,
  errorHandler,
  notFoundHandler,
  sendPlainEnglishError,
} = require('./middleware/errorHandler');

const { app } = require('./server');

let passCount = 0;
let failCount = 0;

/**
 * Custom assertion logger
 */
function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}`);
    passCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName} ${details ? `(${details})` : ''}`);
    failCount++;
  }
}

/**
 * Universal Technical Jargon Scrubber Assertion
 * Ensures no stack traces, raw error codes, file paths, or internal tokens leak into messages.
 */
function assertZeroJargon(message, contextName) {
  const containsJargon = containsTechnicalJargon(message);
  const hasStackTrace = /\bat\s+[\w.<>]+\s*\(?/i.test(message);
  const hasRawMongoCode = /\bE\d{4,5}\b/.test(message);
  const hasMongoClass = /Mongo(Server)?Error|CastError|ValidationError/i.test(message);
  const hasJsErrors = /TypeError:|ReferenceError:|SyntaxError:|RangeError:/i.test(message);
  const hasPaths = /[A-Z]:\\[^ \n\r\t]+|\/(?:var|home|usr|etc|tmp|node_modules)\//i.test(message);
  const hasObjectObject = /\[object\s+Object\]/i.test(message);

  const isClean = !containsJargon && !hasStackTrace && !hasRawMongoCode &&
                  !hasMongoClass && !hasJsErrors && !hasPaths && !hasObjectObject;

  assert(isClean, `[No Jargon] ${contextName}: "${message}"`, 
    `containsJargon=${containsJargon}, stack=${hasStackTrace}, mongoCode=${hasRawMongoCode}, path=${hasPaths}`);
}

async function runErrorMessagingTestSuite() {
  console.log('\n================================================================');
  console.log('   NFR-47 VERIFICATION: PLAIN-ENGLISH ERROR MESSAGING');
  console.log('================================================================\n');

  // ── TEST SUITE 1: Technical Jargon Detection ────────────────────────────────
  console.log('Test Suite 1: Technical Jargon Detector (containsTechnicalJargon)');
  {
    assert(containsTechnicalJargon('Error at Object.<anonymous> (C:\\project\\server.js:45:12)'),
      'Detects stack trace with file path and line number');
    assert(containsTechnicalJargon('MongoServerError: E11000 duplicate key error collection: collabide.users index: emailHash_1 dup key'),
      'Detects MongoServerError and E11000 duplicate key codes');
    assert(containsTechnicalJargon('Cast to ObjectId failed for value "507f1f77bcf86cd799439011" at path "_id"'),
      'Detects Mongoose CastError and ObjectId references');
    assert(containsTechnicalJargon('TypeError: Cannot read properties of undefined (reading "map")'),
      'Detects JavaScript runtime TypeErrors');
    assert(containsTechnicalJargon('ECONNREFUSED 127.0.0.1:27017'),
      'Detects raw network system codes (ECONNREFUSED)');
    assert(containsTechnicalJargon('JsonWebTokenError: jwt malformed'),
      'Detects JWT library internal exceptions');
    assert(containsTechnicalJargon('/var/www/collab-ide/node_modules/express/lib/router/index.js'),
      'Detects Linux filesystem paths');
    assert(containsTechnicalJargon('[object Object]'),
      'Detects unstringified JavaScript object output');

    assert(!containsTechnicalJargon('Invalid email or password. Please try again.'),
      'Accepts natural English authentication failure');
    assert(!containsTechnicalJargon('The requested room could not be found or you do not have permission to view it.'),
      'Accepts natural English 404 message');
    assert(!containsTechnicalJargon('You have made too many requests. Please wait a moment before trying again.'),
      'Accepts natural English rate limit message');
    assert(!containsTechnicalJargon('Please provide a valid code string to run.'),
      'Accepts natural English validation message');
  }

  // ── TEST SUITE 2: Centralized Error Sanitization Logic ───────────────────────
  console.log('\nTest Suite 2: sanitizeErrorToPlainEnglish Error Mappings');
  {
    // Mongo duplicate key (11000) on emailHash
    const dupKeyError = new Error('E11000 duplicate key error collection: collabide.users index: emailHash_1 dup key: { emailHash: "abcdef" }');
    dupKeyError.name = 'MongoServerError';
    dupKeyError.code = 11000;
    dupKeyError.keyPattern = { emailHash: 1 };
    const sanitizedDup = sanitizeErrorToPlainEnglish(dupKeyError);
    assert(sanitizedDup.status === 409, 'Duplicate key maps to HTTP 409 Conflict');
    assert(sanitizedDup.message.includes('An account with this email address already exists'),
      'Translates E11000 emailHash duplicate key to user-friendly account exists message');
    assertZeroJargon(sanitizedDup.message, 'E11000 Duplicate Key');

    // Mongoose CastError (invalid ObjectId)
    const castError = new Error('Cast to ObjectId failed for value "xyz123" at path "_id" for model "Room"');
    castError.name = 'CastError';
    castError.path = '_id';
    const sanitizedCast = sanitizeErrorToPlainEnglish(castError);
    assert(sanitizedCast.status === 400, 'CastError maps to HTTP 400 Bad Request');
    assert(sanitizedCast.message === 'The provided identifier or parameter is invalid. Please verify your input and try again.',
      'Translates CastError into plain English without leaking internal ObjectId type');
    assertZeroJargon(sanitizedCast.message, 'Mongoose CastError');

    // Mongoose ValidationError
    const validationError = new Error('User validation failed: email: Path `email` is invalid.');
    validationError.name = 'ValidationError';
    validationError.errors = {
      email: { message: 'Path `email` is invalid.' },
      password: { message: 'Password is too short.' }
    };
    const sanitizedVal = sanitizeErrorToPlainEnglish(validationError);
    assert(sanitizedVal.status === 400, 'ValidationError maps to HTTP 400');
    assertZeroJargon(sanitizedVal.message, 'Mongoose ValidationError');
    assert(!sanitizedVal.message.includes('Path `email` is invalid'), 'Strips raw Mongoose path syntax from validation error');

    // SyntaxError / JSON body-parser parse failure
    const syntaxError = new SyntaxError('Unexpected token , in JSON at position 15');
    syntaxError.status = 400;
    syntaxError.body = '{"bad": }';
    const sanitizedSyntax = sanitizeErrorToPlainEnglish(syntaxError);
    assert(sanitizedSyntax.status === 400, 'JSON syntax error maps to HTTP 400');
    assert(sanitizedSyntax.message.includes('valid JSON'), 'Translates JSON syntax error into user-friendly guidance');
    assertZeroJargon(sanitizedSyntax.message, 'SyntaxError JSON');

    // JWT Errors
    const jwtMalformed = new Error('jwt malformed');
    jwtMalformed.name = 'JsonWebTokenError';
    const sanitizedJwt = sanitizeErrorToPlainEnglish(jwtMalformed);
    assert(sanitizedJwt.status === 401, 'JsonWebTokenError maps to HTTP 401');
    assert(sanitizedJwt.message.includes('authentication token is invalid'), 'Translates JsonWebTokenError to token message');
    assertZeroJargon(sanitizedJwt.message, 'JsonWebTokenError');

    const jwtExpired = new Error('jwt expired');
    jwtExpired.name = 'TokenExpiredError';
    const sanitizedExpired = sanitizeErrorToPlainEnglish(jwtExpired);
    assert(sanitizedExpired.status === 401, 'TokenExpiredError maps to HTTP 401');
    assert(sanitizedExpired.message.includes('session has expired'), 'Translates TokenExpiredError to session expired message');
    assertZeroJargon(sanitizedExpired.message, 'TokenExpiredError');

    // Decryption failure (tampering / corrupted data)
    const decryptErr = new Error('Unsupported state or unable to authenticate data');
    const sanitizedDecrypt = sanitizeErrorToPlainEnglish(decryptErr);
    assert(sanitizedDecrypt.status === 500, 'Decryption failure maps to HTTP 500');
    assert(sanitizedDecrypt.message.includes('security verification check failed'), 'Translates decryption failure safely');
    assertZeroJargon(sanitizedDecrypt.message, 'Decryption Failure');

    // Generic unhandled runtime error with stack trace
    const unhandledRuntime = new TypeError('Cannot read property "split" of undefined');
    unhandledRuntime.stack = 'TypeError: Cannot read property "split" of undefined\n    at Object.run (C:\\Users\\CollabIDE\\routes\\test.js:12:5)';
    const sanitizedUnhandled = sanitizeErrorToPlainEnglish(unhandledRuntime);
    assert(sanitizedUnhandled.status === 500, 'Unhandled runtime error maps to HTTP 500');
    assertZeroJargon(sanitizedUnhandled.message, 'Unhandled Runtime TypeError');
    assert(sanitizedUnhandled.message === 'An unexpected server error occurred. Please try again later.',
      'Falls back safely to plain English fallback when technical error occurs');
  }

  // ── TEST SUITE 3: HTTP Server Middleware Integration ────────────────────────
  console.log('\nTest Suite 3: HTTP Server Middleware End-to-End Tests');
  
  // Start server on dynamic ephemeral port
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, resolve));
  const port = testServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 3.1: Malformed JSON payload to /api/auth/login
    {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"email": "broken_json',
      });

      const body = await response.json();
      assert(response.status === 400, `Malformed JSON returns HTTP 400 (got ${response.status})`);
      assert(typeof body.message === 'string', 'Malformed JSON returns JSON { message }');
      assertZeroJargon(body.message, 'Malformed JSON API response');
      assert(body.message.includes('valid JSON'), `Malformed JSON message explains format error ("${body.message}")`);
    }

    // 3.2: Unknown API endpoint (404 handler)
    {
      const response = await fetch(`${baseUrl}/api/nonexistent-system-endpoint-xyz`);
      assert(response.status === 404, `Unknown API route returns HTTP 404 (got ${response.status})`);
      
      const contentType = response.headers.get('content-type') || '';
      assert(contentType.includes('application/json'), `Unknown API route returns JSON (not HTML): ${contentType}`);

      const body = await response.json();
      assert(body.message.includes('The requested resource could not be found'), `404 returns plain English message: "${body.message}"`);
      assertZeroJargon(body.message, '404 Not Found API response');
    }

    // 3.3: Invalid / Malformed JWT Authorization Header
    {
      const response = await fetch(`${baseUrl}/api/rooms`, {
        headers: { Authorization: 'Bearer totally-malformed-and-fake-jwt-token-value' },
      });

      const body = await response.json();
      assert(response.status === 401, `Invalid JWT returns HTTP 401 (got ${response.status})`);
      assertZeroJargon(body.message, 'Invalid JWT API response');
      assert(body.message.includes('token is invalid') || body.message.includes('log in again'),
        `Invalid JWT message is user-friendly: "${body.message}"`);
    }

    // 3.4: Missing Authorization Header
    {
      const response = await fetch(`${baseUrl}/api/rooms`);
      const body = await response.json();
      assert(response.status === 401, `Missing JWT returns HTTP 401 (got ${response.status})`);
      assertZeroJargon(body.message, 'Missing JWT API response');
      assert(body.message.includes('Authentication required') && body.message.includes('log in'),
        `Missing JWT message is friendly: "${body.message}"`);
    }

    // 3.5: Validation Failure on Register (missing password)
    {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test.user@example.com' }),
      });

      const body = await response.json();
      assert(response.status === 400, `Missing required field returns HTTP 400 (got ${response.status})`);
      assertZeroJargon(body.message, 'Register validation error API response');
      assert(body.message.includes('required') && body.message.includes('email'),
        `Validation error provides clear guidance: "${body.message}"`);
    }

    // 3.6: Invalid Login Credentials
    {
      const IpBlock = require('./models/IpBlock');
      const User = require('./models/User');
      const origIpFind = IpBlock.findOne;
      const origUserFind = User.findOne;
      const origIpSave = IpBlock.prototype.save;
      const origIpCreate = IpBlock.create;
      IpBlock.findOne = () => ({ exec: () => Promise.resolve(null), then: (f) => Promise.resolve(null).then(f) });
      User.findOne = () => ({ exec: () => Promise.resolve(null), then: (f) => Promise.resolve(null).then(f) });
      IpBlock.prototype.save = async () => {};
      IpBlock.create = async () => ({});

      try {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nonexistent-user-123@example.com', password: 'Password123!' }),
        });

        const body = await response.json();
        assert(response.status === 401, `Invalid credentials returns HTTP 401 (got ${response.status})`);
        assertZeroJargon(body.message, 'Invalid credentials API response');
        assert(body.message.includes('Incorrect email address or password') || body.message.includes('Please try again'),
          `Invalid login credentials returns plain English: "${body.message}"`);
      } finally {
        IpBlock.findOne = origIpFind;
        User.findOne = origUserFind;
        IpBlock.prototype.save = origIpSave;
        IpBlock.create = origIpCreate;
      }
    }
  } finally {
    await new Promise((resolve) => testServer.close(resolve));
  }

  // ── TEST SUITE 4: Frontend Error Formatter (formatErrorMessage) ─────────────
  console.log('\nTest Suite 4: Frontend formatErrorMessage Compatibility');
  {
    // Minimal browser polyfill for api.js dynamic import
    global.window = {
      location: { origin: 'http://localhost:3000' },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    };

    const { formatErrorMessage } = await import('../frontend/src/services/api.js');

    // Network offline / drop
    const networkErr = new TypeError('Failed to fetch');
    const fmtNetwork = formatErrorMessage(networkErr);
    assert(fmtNetwork.includes('Unable to connect to the server'), 'Translates Failed to fetch to connection advice');
    assertZeroJargon(fmtNetwork, 'Frontend Network Drop');

    // Aborted request
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    const fmtAbort = formatErrorMessage(abortErr);
    assert(fmtAbort.includes('cancelled or timed out'), 'Translates AbortError to cancellation advice');
    assertZeroJargon(fmtAbort, 'Frontend Request Abort');

    // Technical server error with internal stack or codes
    const technicalErr = {
      message: 'MongoServerError: E11000 duplicate key error collection: collabide.users index: emailHash_1 dup key',
    };
    const fmtTech = formatErrorMessage(technicalErr, 'Failed to save changes. Please try again.');
    assert(fmtTech === 'Failed to save changes. Please try again.', 'Replaces technical server error message with clean fallback');
    assertZeroJargon(fmtTech, 'Frontend Scrubbed Server Error');

    // Preserved clean server error message
    const cleanServerErr = {
      message: 'An account with this email address already exists. Please log in or use a different email.',
    };
    const fmtClean = formatErrorMessage(cleanServerErr);
    assert(fmtClean === cleanServerErr.message, 'Preserves natural plain-English backend messages');
    assertZeroJargon(fmtClean, 'Frontend Preserved Message');

    // Google OAuth popup closed
    const popupClosedErr = { error: 'popup_closed_by_user' };
    const fmtPopup = formatErrorMessage(popupClosedErr);
    assert(fmtPopup.includes('window was closed'), 'Translates Google OAuth popup closure safely');
    assertZeroJargon(fmtPopup, 'Frontend Popup Closed');

    // Null or undefined error object
    const fmtNull = formatErrorMessage(null, 'Operation failed. Please try again.');
    assert(fmtNull === 'Operation failed. Please try again.', 'Returns fallback message when error is null/undefined');
  }

  // ── SUMMARY REPORT ──────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`   TOTAL TESTS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
  console.log('================================================================\n');

  process.exitCode = failCount > 0 ? 1 : 0;
}

runErrorMessagingTestSuite().catch((err) => {
  console.error('Unhandled test suite exception:', err);
  process.exitCode = 1;
});
