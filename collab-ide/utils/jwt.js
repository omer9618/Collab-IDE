/**
 * @file utils/jwt.js
 * @module utils/jwt
 * @description Centralized JSON Web Token utilities.
 */

const jwt = require('jsonwebtoken');
const { privateKey, publicKey } = require('./keys');

/**
 * Generates an asymmetric RS256 JWT access token with 15-minute expiration (NFR-12, NFR-13).
 *
 * @function generateAccessToken
 * @param {string|import('mongoose').Types.ObjectId} userId - User identifier
 * @param {object} [options={}] - Custom options (e.g. expiresIn)
 * @returns {string} Signed RS256 JWT string
 */
function generateAccessToken(userId, options = {}) {
  const expiresIn = options.expiresIn || process.env.JWT_EXPIRES_IN || '15m';
  return jwt.sign(
    { userId, type: 'access' },
    privateKey,
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
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
}

/**
 * Generates an asymmetric RS256 cryptographically signed Password Reset Token (FR-09).
 *
 * SPECIFICATION (FR-09):
 * Time-limited to exactly 30 minutes, signed with the server's private RSA key,
 * embedding a unique 32-byte cryptographic random identifier (jti) whose SHA-256 hash
 * is tracked in MongoDB to guarantee single-use.
 *
 * @function generatePasswordResetToken
 * @param {string|import('mongoose').Types.ObjectId} userId - User identifier
 * @param {string} rawToken - 32-byte hex entropy token
 * @param {object} [options={}] - Custom options (e.g. expiresIn)
 * @returns {string} Signed RS256 JWT string
 */
function generatePasswordResetToken(userId, rawToken, options = {}) {
  const expiresIn = options.expiresIn || '30m';
  return jwt.sign(
    { sub: userId.toString(), jti: rawToken, type: 'password-reset' },
    privateKey,
    { algorithm: 'RS256', expiresIn }
  );
}

/**
 * Verifies an RS256 Password Reset Token against the server's public key (FR-09).
 *
 * @function verifyPasswordResetToken
 * @param {string} token - Signed JWT reset token
 * @returns {object} Decoded token payload
 */
function verifyPasswordResetToken(token) {
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
};
