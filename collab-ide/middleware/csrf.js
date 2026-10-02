/**
 * ==============================================================================
 * CollabIDE - NFR-15: CSRF Protection Middleware
 * ==============================================================================
 * Implements the Double-Submit Cookie Pattern with SameSite=Strict cookie policy
 * to protect all state-changing endpoints (POST, PUT, PATCH, DELETE) against
 * Cross-Site Request Forgery (CSRF).
 *
 * Requirements & Security Invariants:
 * 1. CSRF cookie ("XSRF-TOKEN") is issued with SameSite=Strict, Path=/, and Secure in production.
 * 2. httpOnly is false specifically so client-side JavaScript can read and echo the token in headers.
 * 3. Token comparison is performed in constant time using crypto.timingSafeEqual.
 * 4. Buffers are length-checked before comparison to prevent timingSafeEqual crashes.
 * 5. Logout clears XSRF-TOKEN with the exact matching cookie options (path, domain, secure, sameSite).
 * 6. Pure programmatic API clients with Authorization: Bearer and zero ambient cookies are exempt.
 */

const crypto = require('crypto');

/**
 * Returns standardized cookie options for the XSRF-TOKEN cookie.
 * Ensures setCookie and clearCookie always share identical flags.
 */
function getCsrfCookieOptions() {
  return {
    httpOnly: false, // Must be readable by client JS to echo in X-CSRF-Token header
    sameSite: 'strict', // NFR-15 requirement
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}

/**
 * Generates a cryptographically strong 32-byte random hex token.
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sets the XSRF-TOKEN cookie on the HTTP response.
 */
function setCsrfCookie(res, token) {
  res.cookie('XSRF-TOKEN', token, getCsrfCookieOptions());
}

/**
 * Clears the XSRF-TOKEN cookie with identical options so it does not linger.
 */
function clearCsrfCookie(res) {
  res.clearCookie('XSRF-TOKEN', getCsrfCookieOptions());
}

/**
 * Constant-time string comparison preventing timing attacks.
 * Explicitly guards against length mismatch to avoid crypto.timingSafeEqual RangeErrors.
 */
function safeTokenCompare(submitted, expected) {
  if (typeof submitted !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const bufSubmitted = Buffer.from(submitted);
  const bufExpected = Buffer.from(expected);

  // timingSafeEqual requires buffers of identical byte length
  if (bufSubmitted.length === 0 || bufExpected.length === 0 || bufSubmitted.length !== bufExpected.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufSubmitted, bufExpected);
}

/**
 * Main CSRF Protection Middleware
 */
function csrfProtection(req, res, next) {
  const method = req.method.toUpperCase();

  // Safe HTTP methods do not mutate state: issue CSRF cookie if absent and proceed
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    if (!req.cookies || !req.cookies['XSRF-TOKEN']) {
      const freshToken = generateCsrfToken();
      setCsrfCookie(res, freshToken);
      req.csrfToken = freshToken;
    } else {
      req.csrfToken = req.cookies['XSRF-TOKEN'];
    }
    return next();
  }

  // State-changing methods: POST, PUT, PATCH, DELETE
  const submittedToken =
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'] ||
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf);

  const cookieToken = req.cookies && (req.cookies['XSRF-TOKEN'] || req.cookies['_csrf']);
  const hasCookies = req.cookies && Object.keys(req.cookies).length > 0;
  const hasBearerAuth = Boolean(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
  
  console.log(`[CSRF Debug] Method: ${method}, Path: ${req.path}`);
  console.log(`[CSRF Debug] Submitted: ${submittedToken}, Cookie: ${cookieToken}`);
  console.log(`[CSRF Debug] Headers:`, req.headers);

  // Branch 1: Pure programmatic API requests presenting Authorization: Bearer with ZERO ambient cookies
  // Browser CSRF cannot occur when no cookies are attached, and browsers cannot set Authorization: Bearer cross-origin without CORS approval.
  if (hasBearerAuth && !hasCookies) {
    // If the caller chose to send a token anyway, validate it if a cookieToken was somehow found
    if (submittedToken && cookieToken && !safeTokenCompare(submittedToken, cookieToken)) {
      return res.status(403).json({
        message: 'CSRF token mismatch',
        code: 'EBADCSRFTOKEN',
      });
    }
    return next();
  }

  // Branch 2: Cookie-bearing requests (All browser requests, session-based routes, and SPA calls)
  // When ANY cookie is present (e.g. XSRF-TOKEN or refreshToken), double-submit validation is strictly enforced.
  if (hasCookies) {
    if (!cookieToken || !submittedToken || !safeTokenCompare(submittedToken, cookieToken)) {
      return res.status(403).json({
        message: 'CSRF token missing or mismatch',
        code: 'EBADCSRFTOKEN',
      });
    }
    return next();
  }

  // Branch 3: Public state-changing requests with neither cookies nor Bearer token (e.g., initial CLI/curl login)
  // If submittedToken was provided, validate it against cookieToken if present
  if (submittedToken && cookieToken) {
    if (!safeTokenCompare(submittedToken, cookieToken)) {
      return res.status(403).json({
        message: 'CSRF token mismatch',
        code: 'EBADCSRFTOKEN',
      });
    }
  }

  return next();
}

module.exports = {
  csrfProtection,
  generateCsrfToken,
  setCsrfCookie,
  clearCsrfCookie,
  getCsrfCookieOptions,
  safeTokenCompare,
};
