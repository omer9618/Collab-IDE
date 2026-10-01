/**
 * @file modules/auth/index.js
 * @module modules/auth
 * @description Authentication & Identity Module (FR-01 – FR-14, NFR-11 – NFR-17, NFR-48).
 * 
 * Encapsulates:
 * - User identity and credential management (registration, login, verification)
 * - Password complexity policy validation (NFR-11: 8+ chars, upper, lower, digit, special)
 * - Asymmetric RS256 JWT access token issuance and verification (NFR-17)
 * - Refresh token family rotation and token reuse replay detection (NFR-13)
 * - Account lockout and IP brute force protection (NFR-14)
 * - Express authentication and authorization route handlers and middleware
 */

const jwt = require('jsonwebtoken');
const authRoutes = require('../../routes/auth');
const authMiddleware = require('../../middleware/auth');
const passwordPolicy = require('../../utils/passwordPolicy');
const keys = require('../../utils/keys');
const User = require('../../models/User');
const RefreshToken = require('../../models/RefreshToken');
const IpBlock = require('../../models/IpBlock');

/**
 * Generates an asymmetric RS256 access token for an authenticated user ID.
 *
 * @function generateAccessToken
 * @param {string} userId - User identifier
 * @param {object} [options={}] - Custom options (e.g. expiresIn)
 * @returns {string} Signed RS256 JWT
 */
function generateAccessToken(userId, options = {}) {
  const expiresIn = options.expiresIn || process.env.JWT_EXPIRES_IN || '15m';
  return jwt.sign(
    { userId, type: 'access' },
    keys.privateKey,
    { algorithm: 'RS256', expiresIn }
  );
}

/**
 * Verifies an RS256 access token against the server's public key.
 *
 * @function verifyAccessToken
 * @param {string} token - Bearer JWT token
 * @returns {object} Decoded token payload
 */
function verifyAccessToken(token) {
  return jwt.verify(token, keys.publicKey, { algorithms: ['RS256'] });
}

/**
 * Validates a plaintext password against the strict CollabIDE policy (NFR-11).
 *
 * @function validatePassword
 * @param {string} password - Candidate password
 * @returns {{ valid: boolean, isValid: boolean, errors: string[], details: object }}
 */
function validatePassword(password) {
  const result = passwordPolicy.validateComplexity(password);
  return {
    valid: result.isValid,
    isValid: result.isValid,
    errors: result.errors,
    details: result.details,
  };
}

/**
 * Returns user-facing list of password requirements.
 *
 * @function getPasswordPolicyRequirements
 * @returns {string[]}
 */
function getPasswordPolicyRequirements() {
  return [
    'Minimum 8 characters in length',
    'At least one uppercase letter (A-Z)',
    'At least one lowercase letter (a-z)',
    'At least one numeric digit (0-9)',
    'At least one special character (!@#$%^&*...)',
  ];
}

// Ensure passwordPolicy object exposes getPasswordPolicyRequirements
if (!passwordPolicy.getPasswordPolicyRequirements) {
  passwordPolicy.getPasswordPolicyRequirements = getPasswordPolicyRequirements;
}

module.exports = {
  name: 'auth',
  routes: authRoutes,
  router: authRoutes,
  middleware: authMiddleware,
  protect: authMiddleware.protect,
  models: {
    User,
    RefreshToken,
    IpBlock,
  },
  passwordPolicy,
  keys,
  generateAccessToken,
  verifyAccessToken,
  validatePassword,
  validateComplexity: passwordPolicy.validateComplexity,
  validatePasswordPolicy: passwordPolicy.validatePasswordPolicy,
  getPasswordPolicyRequirements,
};

