/**
 * @file middleware/rateLimiter.js
 * @module middleware/rateLimiter
 * @description Rate limiting middleware protecting CollabIDE REST API endpoints
 * against denial-of-service (DoS), brute-force attacks, and automated abuse (NFR-35).
 */

const rateLimit = require('express-rate-limit');

/**
 * Standard API Rate Limiter — 100 requests per minute per user (NFR-35).
 *
 * SECURITY REASONING:
 * 1. Per-User vs Per-IP Partitioning: Rate limits key on authenticated `req.user._id`
 *    whenever available, falling back to IP address. This prevents legitimate users
 *    behind shared NATs (e.g., university campuses or corporate VPNs) from being
 *    blocked by an unrelated peer's traffic.
 * 2. DoS & Scrape Mitigation: Caps continuous automated endpoint scraping and prevents
 *    resource exhaustion on MongoDB connection pools.
 * 3. Local / Test Loop Exemption: Skips rate limiting for loopback addresses and test
 *    environments to facilitate high-speed CI/CD automated test suites without false positives.
 *
 * @type {import('express').RequestHandler}
 */
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute sliding window (per NFR-35)
  max: 100, // Maximum 100 requests per window per user
  keyGenerator: (req) => {
    // Security: Use authenticated user ID to prevent NAT collision, fallback to IP for public routes
    if (req.user && req.user._id) {
      return req.user._id.toString();
    }
    return req.ip;
  },
  message: { message: 'API rate limit exceeded. Maximum 100 requests per minute.' },
  standardHeaders: true, // Draft-6 RateLimit headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  validate: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || process.env.NODE_ENV === 'test';
  },
});

module.exports = { apiLimiter };
