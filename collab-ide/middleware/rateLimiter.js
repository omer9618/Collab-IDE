const rateLimit = require('express-rate-limit');

// NFR-35: General API endpoints limit: 100 requests per minute per user
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => {
    if (req.user && req.user._id) {
      return req.user._id.toString();
    }
    return req.ip;
  },
  message: { message: 'API rate limit exceeded. Maximum 100 requests per minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || process.env.NODE_ENV === 'test';
  },
});

module.exports = { apiLimiter };
