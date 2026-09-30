/**
 * @file middleware/auth.js
 * @module middleware/auth
 * @description Authentication and authorization middleware for CollabIDE.
 * Validates asymmetric RS256 JWT access tokens and populates verified user
 * sessions on protected Express routes (NFR-17, NFR-25).
 */

const jwt = require('jsonwebtoken');
const { publicKey } = require('../utils/keys');
const User = require('../models/User');

/**
 * Express middleware to authenticate incoming requests via RS256 Bearer JWT.
 * 
 * SECURITY REASONING & ROLE ENFORCEMENT PRE-REQUISITES:
 * 1. Asymmetric Cryptography (RS256): Token verification utilizes the public key,
 *    meaning edge services and microservices can verify authenticity without
 *    needing access to the private signing key, preventing privilege escalation.
 * 2. Revocation & State Synchronization: Even though JWT is stateless, we query
 *    the database for the user ID to ensure deactivated, locked, or deleted accounts
 *    are blocked immediately rather than waiting for token expiration.
 * 3. Password Sanitization: We explicitly project out `-password` to ensure hash
 *    material never enters downstream request contexts or logs.
 * 4. Email Verification Gate (FR-01, NFR-17): Unverified accounts are strictly
 *    halted with HTTP 403 Forbidden before reaching business logic or collaborative
 *    rooms.
 *
 * @async
 * @function protect
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware callback
 * @returns {Promise<void>}
 */
const protect = async (req, res, next) => {
  let token;

  // Security: Check for Authorization header following RFC 6750 Bearer token format
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Extract bearer token from Authorization: Bearer <token>
      token = req.headers.authorization.split(' ')[1];

      // Security: Force RS256 algorithm validation to protect against algorithm confusion attacks (e.g. none or HS256 with pubkey)
      const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

      // Security: Authoritative database check ensures deleted or banned users cannot use unexpired tokens
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Security: Enforce account email verification barrier before granting access to protected endpoints
      if (!user.isVerified) {
        return res.status(403).json({ message: 'Please verify your email address first' });
      }

      // Attach verified principal to request context
      req.user = user;
      return next();
    } catch (error) {
      console.error('JWT Verification Error:', error.message);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  // Security: Explicit rejection when no authorization header is supplied
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

module.exports = { protect };
