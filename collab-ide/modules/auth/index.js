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

const { generateAccessToken, verifyAccessToken } = require('../../utils/jwt');
const authRoutes = require('../../routes/auth');
const authMiddleware = require('../../middleware/auth');
const passwordPolicy = require('../../utils/passwordPolicy');
const keys = require('../../utils/keys');
const User = require('../../models/User');
const RefreshToken = require('../../models/RefreshToken');
const IpBlock = require('../../models/IpBlock');



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

/**
 * Stateless REST API Configuration & Invariant Descriptor (NFR-51).
 * Declares that session state is strictly maintained in tokens and the database,
 * never in server memory, enabling horizontal scaling across arbitrary node clusters.
 */
const stateless = {
  enabled: true,
  sessionStorage: 'tokens-and-db',
  inMemorySessionStore: false,
  tokenType: 'RS256-JWT',
  refreshTokenStore: 'mongodb',
  supportsHorizontalScaling: true,
};

/**
 * Asserts that an Express app or request pipeline contains zero server-side stateful session stores (NFR-51).
 *
 * @function assertStatelessPipeline
 * @param {import('express').Application} [app] - Express application instance
 * @returns {{ isStateless: boolean, inMemorySessionStore: boolean, sessionStorage: string }}
 */
function assertStatelessPipeline(app) {
  if (app) {
    const router = app.router || app._router;
    const stack = (router && Array.isArray(router.stack))
      ? router.stack
      : (app._router && Array.isArray(app._router.stack))
        ? app._router.stack
        : [];

    const hasStatefulSession = stack.some(layer => {
      const name = (layer.name || '').toLowerCase();
      const fnName = (layer.handle && layer.handle.name ? layer.handle.name : '').toLowerCase();
      return name === 'session' || fnName === 'session' || name === 'expresssession' || fnName === 'expresssession';
    });
    if (hasStatefulSession) {
      throw new Error('NFR-51 Violation: Stateful session middleware detected in Express pipeline.');
    }
  }
  return {
    isStateless: true,
    inMemorySessionStore: false,
    sessionStorage: 'tokens-and-db',
  };
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
  stateless,
  assertStatelessPipeline,
};

