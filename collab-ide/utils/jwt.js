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

module.exports = {
  generateAccessToken,
  verifyAccessToken
};
