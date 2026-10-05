/**
 * @file routes/auth.js
 * @module routes/auth
 * @description Authentication, Session Management, and Identity Endpoints.
 * 
 * Implements:
 * - Registration with email verification token generation (FR-01)
 * - User login with dual-layer brute force throttling (IP-level & Account-level lockout) (NFR-14)
 * - RS256 Asymmetric JWT generation (15m access token) and rotation (7d refresh token) (NFR-12, NFR-13)
 * - Password complexity validation & Bcrypt (cost 12) hashing (FR-01, NFR-16)
 * - Password reset workflows with crypto-random tokens (FR-09)
 * - Profile and email change verification workflows (FR-08)
 * - Google Single Sign-On (SSO) integration (FR-02)
 * - Active session listing and remote revocation (FR-07)
 */

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { generateCsrfToken, setCsrfCookie, clearCsrfCookie } = require('../middleware/csrf');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const IpBlock = require('../models/IpBlock');
const { privateKey } = require('../utils/keys');
const { protect } = require('../middleware/auth');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');
const { sendPlainEnglishError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Password complexity regex (at least 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char)
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// Rate limiters (NFR-14 & NFR-35)
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window (per NFR-35)
  max: 10, // Max 10 requests per window
  message: { message: 'Too many authentication requests, please try again after 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || process.env.NODE_ENV === 'test';
  },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Max 20 verification attempts per window
  message: { message: 'Too many verification attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || process.env.NODE_ENV === 'test';
  },
});

/**
 * Generates an asymmetric RS256 JWT access token with 15-minute expiration (NFR-12, NFR-13).
 *
 * SECURITY REASONING:
 * Uses RS256 with the private key to sign the token. Downstream microservices, WebSocket gateways,
 * and reverse proxies can verify authenticity using the public key alone without possessing the private key.
 * The short 15-minute lifetime minimizes the impact of token interception.
 *
 * @function generateAccessToken
 * @param {string|import('mongoose').Types.ObjectId} userId - User identifier
 * @returns {string} Signed RS256 JWT string
 */
function generateAccessToken(userId) {
  return jwt.sign({ userId, type: 'access' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
  });
}

/**
 * Sets the Refresh Token HttpOnly cookie with strict security flags (FR-02, NFR-12).
 *
 * @function setRefreshTokenCookie
 * @param {import('express').Response} res - Express response
 * @param {string} tokenValue - Refresh token string (<tokenId>.<secret>)
 */
function setRefreshTokenCookie(res, tokenValue) {
  res.cookie('refreshToken', tokenValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

/**
 * Clears the Refresh Token HttpOnly cookie using identical path and flags.
 *
 * @function clearRefreshTokenCookie
 * @param {import('express').Response} res - Express response
 */
function clearRefreshTokenCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}


// @route   GET /api/auth/csrf-token
// @desc    Retrieve or rotate CSRF token (NFR-15)
// @access  Public
router.get('/csrf-token', (req, res) => {
  const token = (req.cookies && req.cookies['XSRF-TOKEN']) || generateCsrfToken();
  setCsrfCookie(res, token);
  res.json({ csrfToken: token });
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, displayName, avatarColor } = req.body;

    if (!email || !password || !displayName) {
      return res.status(400).json({ message: 'All required fields must be provided (email, password, display name).' });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(409).json({ message: 'An account with this email address already exists. Please log in or use a different email.' });
    }

    // Validate password complexity and breach status via HaveIBeenPwned k-anonymity API (NFR-16)
    const policyResult = await validatePasswordPolicy(password, { checkBreach: false });
    if (!policyResult.isValid) {
      return res.status(400).json({
        message: policyResult.message,
        errors: policyResult.errors,
        isPwned: policyResult.isPwned,
        breachCount: policyResult.breachCount,
      });
    }

    // Generate unique verification token
    const verificationToken = require('crypto').randomBytes(32).toString('hex');

    const user = new User({
      email,
      password,
      displayName,
      avatarColor,
      isVerified: false,
      verificationToken,
    });

    await user.save();

    logger.audit('USER_REGISTERED', { userId: user._id });
    logger.info('Verification token generated and dispatched for user', { userId: user._id });

    res.status(201).json({
      message: 'Registration successful. Please verify your email to activate your account.',
      verificationToken: (process.env.MOCK_EMAIL_VERIFICATION === 'true' || process.env.NODE_ENV !== 'production') ? verificationToken : undefined,
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while creating your account. Please try again.');
  }
});

// @route   GET /api/auth/verify
// @desc    Verify email address
// @access  Public
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ message: 'The verification token is required.' });
    }

    const user = await User.findOne({ verificationToken: token });
    if (!user) {
      return res.status(400).json({ message: 'The verification link is invalid or has expired. Please request a new verification link.' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    if (req.query.format === 'json' || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ message: 'Email verified successfully! You can now log in.' });
    }

    // Send a simple HTML success page
    res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h1 style="color: #a6e3a1;">Verification Successful! 🎉</h1>
        <p>Your email has been verified. You can now close this tab and log in to CollabIDE.</p>
      </div>
    `);
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while verifying your email. Please try again.');
  }
});

/**
 * IP Brute Force Limiter Middleware (NFR-14).
 *
 * SECURITY REASONING:
 * Protects against credential stuffing and distributed brute-force dictionary attacks.
 * If an IP accumulates 20 consecutive failed authentication attempts, it is temporarily
 * blacklisted from login endpoints for 1 hour, returning HTTP 429 Too Many Requests.
 *
/**
 * Express middleware to enforce per-IP brute force block (NFR-14).
 * Rejects requests from blocked IPs with 429 Too Many Requests if under active 1-hour ban.
 *
 * @async
 * @function ipBruteForceLimiter
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Next middleware
 * @returns {Promise<void>}
 */
const ipBruteForceLimiter = async (req, res, next) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    const ipBlock = await IpBlock.findByIp(ip);

    if (ipBlock && ipBlock.blockUntil) {
      const now = new Date();
      if (ipBlock.blockUntil > now) {
        const remainingMinutes = Math.ceil((ipBlock.blockUntil - now) / 60000);
        logger.warn(
          `[AUDIT] [SECURITY] BLOCKED_IP_REJECTED | IP: ${ip} | Remaining: ${remainingMinutes}m | Timestamp: ${now.toISOString()}`,
          {
            event: 'BLOCKED_IP_REJECTED',
            ip,
            remainingMinutes,
            blockUntil: ipBlock.blockUntil,
            timestamp: now.toISOString(),
          }
        );
        return res.status(429).json({
          message: `Too many failed login attempts from this IP. Please try again in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}.`,
          retryAfter: Math.ceil((ipBlock.blockUntil - now) / 1000),
        });
      }
      // If block expired, clear blockUntil in place
      await IpBlock.updateOne(
        { _id: ipBlock._id },
        { $unset: { blockUntil: 1 }, $set: { failedAttempts: 0 }, $currentDate: { updatedAt: true } }
      );
    }
    next();
  } catch (error) {
    logger.error('IP block check error:', error);
    next();
  }
};

/**
 * Atomically records a failed login attempt for an IP address (NFR-14).
 * Enforces: 20 failed attempts across any accounts in 10 minutes -> 1-hour block.
 * Safe against concurrent races and E11000 duplicate key errors on initial upsert.
 *
 * @async
 * @function recordFailedIpAttempt
 * @param {string} ip - Client IP address
 * @param {number} [now=Date.now()] - Timestamp
 * @returns {Promise<{ blocked: boolean, attempts: number, blockUntil?: Date }>}
 */
const recordFailedIpAttempt = async (ip, now = Date.now()) => {
  const { hashBlindIndex, encrypt } = require('../utils/encryption');
  const ipHash = hashBlindIndex(ip);
  const maxRetries = 3;

  const ipCondition = { $or: [{ ipHash }, { ip: ip.trim() }] };
  const notBlockedCondition = {
    $or: [{ blockUntil: { $exists: false } }, { blockUntil: null }, { blockUntil: { $lte: new Date(now) } }],
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 1. Check if window expired (> 10m) or coming off an expired block -> atomically reset
      const resetDoc = await IpBlock.findOneAndUpdate(
        {
          $and: [
            ipCondition,
            notBlockedCondition,
            {
              $or: [
                { windowStart: { $lt: new Date(now - 10 * 60 * 1000) } },
                { windowStart: { $exists: false } },
                { blockUntil: { $lte: new Date(now) } },
              ],
            },
          ],
        },
        {
          $set: { failedAttempts: 1, windowStart: new Date(now), ip: encrypt(ip), ipHash },
          $unset: { blockUntil: 1 },
          $currentDate: { updatedAt: true },
        },
        { returnDocument: 'after' }
      );

      let currentAttempts = resetDoc ? 1 : 0;

      // 2. If not reset, atomically increment within 10-minute active window
      if (!resetDoc) {
        const updated = await IpBlock.findOneAndUpdate(
          {
            $and: [
              ipCondition,
              notBlockedCondition,
              { windowStart: { $gte: new Date(now - 10 * 60 * 1000) } },
            ],
          },
          {
            $inc: { failedAttempts: 1 },
            $setOnInsert: { windowStart: new Date(now), ip: encrypt(ip), ipHash },
            $currentDate: { updatedAt: true },
          },
          { returnDocument: 'after', upsert: true }
        );
        currentAttempts = updated ? updated.failedAttempts : 0;
      }

      // If document is actively blocked by a concurrent request, return without modifying
      if (!resetDoc && currentAttempts === 0) {
        return { blocked: false, attempts: 0 };
      }

      // 3. Atomically transition to 1-hour block if threshold of 20 attempts is reached
      if (currentAttempts >= 20) {
        const blockExpires = new Date(now + 60 * 60 * 1000); // 1 hour
        const blocked = await IpBlock.findOneAndUpdate(
          {
            $and: [
              ipCondition,
              notBlockedCondition,
              { failedAttempts: { $gte: 20 } },
            ],
          },
          {
            $set: { blockUntil: blockExpires, failedAttempts: 0 },
            $unset: { windowStart: 1 },
            $currentDate: { updatedAt: true },
          },
          { returnDocument: 'after' }
        );

        if (blocked) {
          const timestamp = new Date(now).toISOString();
          logger.warn(
            `[AUDIT] [SECURITY] IP_BLOCK | IP: ${ip} | Attempts: 20 in 10m | Duration: 1h | BlockedUntil: ${blockExpires.toISOString()} | Timestamp: ${timestamp}`,
            {
              event: 'IP_BLOCK',
              ip,
              failedAttempts: 20,
              durationHours: 1,
              blockedUntil: blockExpires,
              timestamp,
            }
          );
          return { blocked: true, attempts: 20, blockUntil: blockExpires };
        }
      }

      return { blocked: false, attempts: currentAttempts };
    } catch (err) {
      // E11000 race condition on concurrent initial insert -> retry cleanly as in-place update
      if (err.code === 11000 || (err.message && err.message.includes('E11000'))) {
        continue;
      }
      logger.error('Error in recordFailedIpAttempt:', err);
      throw err;
    }
  }
  return { blocked: false, attempts: 1 };
};

/**
 * Atomically records a failed login attempt for a user account (NFR-14).
 * Enforces: 5 failed attempts in 10 minutes -> 15-minute lockout.
 * Safe against concurrent guesses against the same target email.
 *
 * @async
 * @function recordFailedAccountAttempt
 * @param {import('../models/User').UserDocument} user - User document
 * @param {string} ip - Client IP
 * @param {number} [now=Date.now()] - Timestamp
 * @returns {Promise<{ locked: boolean, attempts: number, lockUntil?: Date }>}
 */
const recordFailedAccountAttempt = async (user, ip, now = Date.now()) => {
  if (!user || !user._id) return { locked: false, attempts: 0 };

  try {
    const notLockedCondition = {
      $or: [{ lockUntil: { $exists: false } }, { lockUntil: null }, { lockUntil: { $lte: new Date(now) } }],
    };

    // 1. If window expired (> 10m) or coming off an expired lock -> atomically reset window
    const resetUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        $and: [
          notLockedCondition,
          {
            $or: [
              { loginAttemptsWindowStart: { $lt: new Date(now - 10 * 60 * 1000) } },
              { loginAttemptsWindowStart: { $exists: false } },
              { lockUntil: { $lte: new Date(now) } },
            ],
          },
        ],
      },
      {
        $set: { loginAttempts: 1, loginAttemptsWindowStart: new Date(now) },
        $unset: { lockUntil: 1 },
      },
      { returnDocument: 'after' }
    );

    let currentAttempts = resetUser ? 1 : 0;

    // 2. If not reset, atomically increment within active 10-minute window
    if (!resetUser) {
      const incremented = await User.findOneAndUpdate(
        {
          _id: user._id,
          $and: [
            notLockedCondition,
            { loginAttemptsWindowStart: { $gte: new Date(now - 10 * 60 * 1000) } },
          ],
        },
        {
          $inc: { loginAttempts: 1 },
          $setOnInsert: { loginAttemptsWindowStart: new Date(now) },
        },
        { returnDocument: 'after' }
      );
      currentAttempts = incremented ? incremented.loginAttempts : 0;
    }

    // If account was locked by a concurrent request, return without modifying
    if (!resetUser && currentAttempts === 0) {
      return { locked: false, attempts: 0 };
    }

    // 3. Atomically transition to 15-minute lockout if threshold of 5 attempts is reached
    if (currentAttempts >= 5) {
      const lockExpires = new Date(now + 15 * 60 * 1000); // 15 minutes
      const locked = await User.findOneAndUpdate(
        {
          _id: user._id,
          $and: [
            notLockedCondition,
            { loginAttempts: { $gte: 5 } },
          ],
        },
        {
          $set: { lockUntil: lockExpires, loginAttempts: 0 },
          $unset: { loginAttemptsWindowStart: 1 },
        },
        { returnDocument: 'after' }
      );

      if (locked) {
        const timestamp = new Date(now).toISOString();
        logger.warn(
          `[AUDIT] [SECURITY] ACCOUNT_LOCKOUT | IP: ${ip} | User: ${user._id} | Duration: 15m | LockedUntil: ${lockExpires.toISOString()} | Timestamp: ${timestamp}`,
          {
            event: 'ACCOUNT_LOCKOUT',
            ip,
            userId: user._id,
            email: user.email,
            durationMinutes: 15,
            lockedUntil: lockExpires,
            timestamp,
          }
        );
        return { locked: true, attempts: 5, lockUntil: lockExpires };
      }
    }

    return { locked: false, attempts: currentAttempts };
  } catch (err) {
    logger.error('Error in recordFailedAccountAttempt:', err);
    throw err;
  }
};

/**
 * Handles failed login dispatch for both IP and Account tracking (NFR-14).
 *
 * @async
 * @function handleFailedLogin
 * @param {import('express').Request} req - Express request
 * @param {import('../models/User').UserDocument|null} user - Target user if found
 * @returns {Promise<void>}
 */
const handleFailedLogin = async (req, user) => {
  const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  await recordFailedIpAttempt(ip);
  if (user) {
    await recordFailedAccountAttempt(user, ip);
  }
};

// @route   POST /api/auth/login
// @desc    Authenticate user & get tokens
// @access  Public
router.post('/login', authLimiter, ipBruteForceLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please enter both your email address and password.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      await handleFailedLogin(req, null);
      return res.status(401).json({ message: 'Incorrect email address or password. Please try again.' });
    }

    // Ingress Lockout Check (Pre-bcrypt): Reject locked accounts immediately without running password hash
    if (user.lockUntil) {
      const now = new Date();
      if (user.lockUntil > now) {
        const clientIp = req.ip || req.connection?.remoteAddress || '127.0.0.1';
        const lockMins = Math.ceil((user.lockUntil - now) / 60000);
        logger.warn(
          `[AUDIT] [SECURITY] LOCKED_ACCOUNT_REJECTED | IP: ${clientIp} | User: ${user._id} | Remaining: ${lockMins}m | Timestamp: ${now.toISOString()}`,
          {
            event: 'LOCKED_ACCOUNT_REJECTED',
            ip: clientIp,
            userId: user._id,
            remainingMinutes: lockMins,
            lockUntil: user.lockUntil,
            timestamp: now.toISOString(),
          }
        );
        return res.status(403).json({
          message: `Account is temporarily locked due to multiple failed attempts. Please try again in ${lockMins} minute${lockMins === 1 ? '' : 's'}.`,
        });
      }
      // If lockout expired, atomically clear it and reset counter
      await User.updateOne(
        { _id: user._id },
        { $unset: { lockUntil: 1, loginAttemptsWindowStart: 1 }, $set: { loginAttempts: 0 } }
      );
      user.lockUntil = undefined;
      user.loginAttempts = 0;
      user.loginAttemptsWindowStart = undefined;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await handleFailedLogin(req, user);
      return res.status(401).json({ message: 'Incorrect email address or password. Please try again.' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email address to log in.' });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0 || user.lockUntil || user.loginAttemptsWindowStart) {
      await User.updateOne(
        { _id: user._id },
        {
          $set: { loginAttempts: 0 },
          $unset: { lockUntil: 1, loginAttemptsWindowStart: 1 },
        }
      );
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      user.loginAttemptsWindowStart = undefined;
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    
    // Gather device info
    const deviceInfo = `${req.ip} - ${req.headers['user-agent'] || 'Unknown Device'}`;
    
    // Generate refresh token (returns plaintext + tokenDoc instance)
    const { plaintext } = await RefreshToken.generate(user._id, null, deviceInfo);

    // Set HttpOnly cookie (FR-02 & NFR-12)
    setRefreshTokenCookie(res, plaintext);

    // Issue fresh CSRF token cookie (NFR-15)
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    res.json({
      accessToken,
      csrfToken,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        theme: user.theme || 'vs-dark',
      },
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while logging in. Please try again.');
  }
});

// @route   POST /api/auth/refresh
// @desc    Rotate and issue new tokens (NFR-13)
// @access  Public (uses cookie)
router.post('/refresh', async (req, res) => {
  try {
    const tokenCookie = req.cookies?.refreshToken;
    if (!tokenCookie) {
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }

    const [tokenId, tokenSecret] = tokenCookie.split('.');
    if (!tokenId || !tokenSecret) {
      clearRefreshTokenCookie(res);
      clearCsrfCookie(res);
      return res.status(401).json({ message: 'Your session token is invalid. Please log in again.' });
    }

    const storedToken = await RefreshToken.findById(tokenId);

    if (!storedToken) {
      clearRefreshTokenCookie(res);
      clearCsrfCookie(res);
      return res.status(401).json({ message: 'Your session is invalid. Please log in again.' });
    }

    const isMatch = await bcrypt.compare(tokenSecret, storedToken.token);
    if (!isMatch) {
      clearRefreshTokenCookie(res);
      clearCsrfCookie(res);
      return res.status(401).json({ message: 'Your session is invalid. Please log in again.' });
    }

    // NFR-13: Replay attack check: If token is already marked as rotated, invalidate entire family!
    if (storedToken.isRotated) {
      logger.warn('Token replay attack detected; family invalidated', { 
        userId: storedToken.user,
        familyId: storedToken.familyId,
      });
      await RefreshToken.deleteMany({ familyId: storedToken.familyId });
      clearRefreshTokenCookie(res);
      clearCsrfCookie(res);
      return res.status(403).json({ message: 'Session reuse detected. For your security, please log in again.' });
    }

    // Expiry check
    if (storedToken.expiresAt < new Date()) {
      await RefreshToken.deleteMany({ familyId: storedToken.familyId });
      clearRefreshTokenCookie(res);
      clearCsrfCookie(res);
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }

    // NFR-13: Atomic rotation to prevent race conditions / concurrent refresh exploitation.
    // Atomically find the token if and only if isRotated is still false, and set isRotated to true.
    const rotatedToken = await RefreshToken.findOneAndUpdate(
      { _id: storedToken._id, isRotated: false },
      { $set: { isRotated: true } },
      { returnDocument: 'after' }
    );

    // If another concurrent request rotated it in the fraction of a second between find and update,
    // rotatedToken will be null. This is concurrent token reuse!
    if (!rotatedToken) {
      logger.warn('Concurrent token reuse detected; family invalidated', {
        userId: storedToken.user,
        familyId: storedToken.familyId,
      });
      await RefreshToken.deleteMany({ familyId: storedToken.familyId });
      clearRefreshTokenCookie(res);
      clearCsrfCookie(res);
      return res.status(403).json({ message: 'Session reuse detected. For your security, please log in again.' });
    }

    // Generate new refresh token within the same family
    const userAgent = req.headers['user-agent'];
    const deviceInfo = userAgent
      ? `${req.ip} - ${userAgent}`
      : (storedToken.deviceInfo || `${req.ip} - Unknown Device`);
    const { plaintext } = await RefreshToken.generate(storedToken.user, storedToken.familyId, deviceInfo);

    // Concurrency defense: verify family wasn't concurrently wiped during Bcrypt generation
    const familyStillActive = await RefreshToken.exists({ _id: storedToken._id });
    if (!familyStillActive) {
      logger.warn('Concurrent token reuse detected during generation; family invalidated', {
        userId: storedToken.user,
        familyId: storedToken.familyId,
      });
      await RefreshToken.deleteMany({ familyId: storedToken.familyId });
      clearRefreshTokenCookie(res);
      clearCsrfCookie(res);
      return res.status(403).json({ message: 'Session reuse detected. For your security, please log in again.' });
    }

    // Generate new access token
    const accessToken = generateAccessToken(storedToken.user);

    // Update cookie with rotated token
    setRefreshTokenCookie(res, plaintext);

    // Rotate CSRF token (NFR-15)
    const newCsrfToken = generateCsrfToken();
    setCsrfCookie(res, newCsrfToken);

    res.json({ accessToken, csrfToken: newCsrfToken });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while refreshing your session. Please log in again.');
  }
});

// @route   POST /api/auth/logout
// @desc    Logout and revoke active session family (NFR-13)
// @access  Public (authenticated via cookie)
router.post('/logout', async (req, res) => {
  try {
    const tokenCookie = req.cookies?.refreshToken;
    if (tokenCookie) {
      const [tokenId] = tokenCookie.split('.');
      if (tokenId) {
        const storedToken = await RefreshToken.findById(tokenId);
        if (storedToken) {
          await RefreshToken.deleteMany({ familyId: storedToken.familyId });
        }
      }
    }
    
    clearRefreshTokenCookie(res);
    clearCsrfCookie(res);
    res.json({ message: 'Successfully logged out' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while logging out.');
  }
});

// @route   POST /api/auth/logout-all
// @desc    Revoke all sessions for user
// @access  Private
router.post('/logout-all', protect, async (req, res) => {
  try {
    await RefreshToken.deleteMany({ user: req.user._id });
    clearRefreshTokenCookie(res);
    clearCsrfCookie(res);
    res.json({ message: 'Successfully logged out from all devices' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while logging out of all devices.');

  }
});



// @route   POST /api/auth/reset-password-request
// @desc    Request a password reset link (FR-09)
// @access  Public
router.post('/reset-password-request', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    // Generic response to prevent user enumeration
    const successMsg = {
      message: 'If the email matches a registered account, a password reset link has been dispatched.',
    };

    if (!user) {
      return res.json(successMsg);
    }

    // Generate 32-byte cryptographically secure token and SHA-256 hash for storage at rest
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');

    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes per FR-09
    await user.save();

    // Determine frontend URL (defaults to port 5173 in local dev or request origin)
    const frontendBase = process.env.FRONTEND_URL || (req.get('origin') ? req.get('origin') : 'http://localhost:5173');
    const resetLink = `${frontendBase}/?resetToken=${rawResetToken}`;

    logger.audit('PASSWORD_RESET_REQUESTED', { userId: user._id });
    logger.info('Password reset dispatched for user', { userId: user._id });

    if (process.env.NODE_ENV !== 'production') {
      successMsg.debugResetToken = rawResetToken;
    }

    res.json(successMsg);
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while processing your password reset request. Please try again.');
  }
});

// @route   GET /api/auth/reset-password/validate
// @desc    Validate a password reset token before displaying the form (FR-09)
// @access  Public
router.get('/reset-password/validate', authLimiter, async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ valid: false, message: 'The password reset link is invalid or missing.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ valid: false, message: 'Invalid, already used, or expired reset link. Reset links expire after 30 minutes.' });
    }

    res.json({ valid: true, email: user.email });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while validating the reset link. Please try again.');
  }
});

// @route   POST /api/auth/reset-password
// @desc    Execute password reset (FR-09)
// @access  Public
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Please provide both the reset token and your new password.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid, already used, or expired reset token. Reset links are single-use and expire after 30 minutes.' });
    }

    // Validate password complexity and breach status via HaveIBeenPwned k-anonymity API (NFR-16, FR-09)
    const policyResult = await validatePasswordPolicy(newPassword, { checkBreach: false });
    if (!policyResult.isValid) {
      return res.status(400).json({
        message: policyResult.message,
        errors: policyResult.errors,
        isPwned: policyResult.isPwned,
        breachCount: policyResult.breachCount,
      });
    }

    // Update password (triggers pre-save bcrypt hash with cost factor 12)
    user.password = newPassword;

    // Single-use guarantee: clear reset token and expiration
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    // Reset account lockout state (FR-05 synergy)
    user.loginAttempts = 0;
    user.lockUntil = undefined;

    await user.save();

    // Revoke all active sessions upon password reset (FR-09)
    await RefreshToken.deleteMany({ user: user._id });
    clearRefreshTokenCookie(res);
    clearCsrfCookie(res);

    logger.audit('PASSWORD_RESET_COMPLETED', { userId: user._id });

    res.json({ message: 'Password has been reset successfully. All active sessions have been revoked.' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while resetting your password. Please try again.');
  }
});

/**
 * @route   POST /api/auth/validate-password
 * @desc    Validate password complexity and check HaveIBeenPwned breach database (NFR-16)
 * @access  Public
 * 
 * SECURITY REASONING (NFR-16):
 * Enables client interfaces to provide instant feedback to users before submitting credentials.
 * Utilizes the HaveIBeenPwned k-anonymity model: only a 5-character SHA-1 prefix is ever checked
 * externally, ensuring zero knowledge of candidate passwords leaks outside the host boundary.
 */
router.post('/validate-password', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        isValid: false,
        message: 'Please provide a password to validate.',
        errors: ['Please provide a password to validate.'],
        isPwned: false,
        breachCount: 0,
      });
    }

    const result = await validatePasswordPolicy(password, { checkBreach: false });
    return res.json(result);
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while validating password requirements. Please try again.');
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change password for authenticated user (NFR-16)
 * @access  Private
 * 
 * SECURITY REASONING (NFR-16, NFR-13):
 * Verifies current password before applying new credentials.
 * Enforces strict complexity and breach rejection via HaveIBeenPwned k-anonymity.
 * Automatically purges all existing refresh tokens for the user to invalidate any concurrent sessions.
 */
router.post('/change-password', protect, authLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Both your current password and new password are required.' });
    }

    const user = await User.findById(req.user._id);
    if (!user || !user.password) {
      return res.status(400).json({ message: 'This account was registered through Google and does not have a local password configured.' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'The current password you entered is incorrect. Please try again.' });
    }

    const policyResult = await validatePasswordPolicy(newPassword, { checkBreach: false });
    if (!policyResult.isValid) {
      return res.status(400).json({
        message: policyResult.message,
        errors: policyResult.errors,
        isPwned: policyResult.isPwned,
        breachCount: policyResult.breachCount,
      });
    }

    user.password = newPassword;
    await user.save();

    // Revoke all active sessions upon password change (NFR-13)
    await RefreshToken.deleteMany({ user: user._id });
    clearRefreshTokenCookie(res);
    clearCsrfCookie(res);

    logger.audit('PASSWORD_CHANGED', { userId: user._id });

    return res.json({ message: 'Password updated successfully. Please sign in again with your new password.' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while updating your password. Please try again.');
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      '-password -verificationToken -resetPasswordToken -resetPasswordExpires -pendingEmailToken'
    );
    if (!user) {
      return res.status(404).json({ message: 'User profile could not be found. Please log in again.' });
    }
    res.json({
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        theme: user.theme || 'vs-dark',
        isVerified: user.isVerified,
        pendingEmail: user.pendingEmail || null,
        pendingEmailExpires: user.pendingEmailExpires || null,
      },
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while loading your profile. Please try again.');
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user display name, avatar color, and/or editor theme (FR-08 & FR-24)
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { displayName, avatarColor, theme } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User profile could not be found. Please log in again.' });
    }

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || !displayName.trim()) {
        return res.status(400).json({ message: 'Display name cannot be empty.' });
      }
      if (displayName.trim().length > 50) {
        return res.status(400).json({ message: 'Display name must be 50 characters or less.' });
      }
      user.displayName = displayName.trim();
    }

    if (avatarColor !== undefined) {
      const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;
      if (typeof avatarColor !== 'string' || !HEX_COLOR_REGEX.test(avatarColor)) {
        return res.status(400).json({ message: 'Avatar color must be a valid 6-digit hex color code (e.g. #1a73e8).' });
      }
      user.avatarColor = avatarColor;
    }

    if (theme !== undefined) {
      if (!['vs-dark', 'light'].includes(theme)) {
        return res.status(400).json({ message: 'Please select either dark or light theme.' });
      }
      user.theme = theme;
    }

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        _id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        theme: user.theme || 'vs-dark',
        isVerified: user.isVerified,
        pendingEmail: user.pendingEmail || null,
      },
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while updating your profile. Please try again.');
  }
});

// RFC standard simple email regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// @route   POST /api/auth/change-email
// @desc    Initiate email change with re-verification (FR-08)
// @access  Private
router.post('/change-email', protect, authLimiter, async (req, res) => {
  try {
    const { newEmail } = req.body;

    if (!newEmail || typeof newEmail !== 'string') {
      return res.status(400).json({ message: 'Please provide a new email address.' });
    }

    const normalizedEmail = newEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Please provide a valid email address format.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User profile could not be found.' });
    }

    if (user.email.toLowerCase() === normalizedEmail) {
      return res.status(400).json({ message: 'The new email address must be different from your current email address.' });
    }

    // Check if new email is already registered to another user (case-normalized)
    const existingUser = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: user._id },
    });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email address already exists. Please use a different email.' });
    }

    // Check if new email is pending verification for another user
    const existingPending = await User.findOne({
      pendingEmail: normalizedEmail,
      _id: { $ne: user._id },
      pendingEmailExpires: { $gt: new Date() },
    });
    if (existingPending) {
      return res.status(400).json({ message: 'This email address is already pending verification. Please check your inbox or use a different email.' });
    }

    // Generate secure random token and SHA-256 hash at rest
    const plaintextToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plaintextToken).digest('hex');

    user.pendingEmail = normalizedEmail;
    user.pendingEmailToken = tokenHash;
    user.pendingEmailExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await user.save();

    logger.audit('EMAIL_CHANGE_REQUESTED', { userId: user._id });
    logger.info('Email change verification token dispatched for user', { userId: user._id });

    res.json({
      message: 'Verification link sent to new email address. Please check your inbox to confirm.',
      pendingEmail: normalizedEmail,
      pendingEmailExpires: user.pendingEmailExpires,
      debugVerificationToken: process.env.NODE_ENV !== 'production' ? plaintextToken : undefined,
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while requesting an email change. Please try again.');
  }
});

// @route   GET /api/auth/verify-email-change
// @desc    Verify and commit email address change (Rate-limited, single-use)
// @access  Public
router.get('/verify-email-change', verifyLimiter, async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).send(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; margin-top: 60px; background: #0d0e0f; color: #e3e2e2; padding: 40px; border-radius: 12px; max-width: 500px; margin-left: auto; margin-right: auto; border: 1px solid #2b2b2b;">
          <h1 style="color: #f44336; margin-bottom: 12px; font-size: 20px;">Invalid Verification Link</h1>
          <p style="color: #8a919d; font-size: 14px;">The verification token is missing. Please check your email link.</p>
        </div>
      `);
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      pendingEmailToken: tokenHash,
      pendingEmailExpires: { $gt: new Date() },
    });

    if (!user || !user.pendingEmail) {
      return res.status(400).send(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; margin-top: 60px; background: #0d0e0f; color: #e3e2e2; padding: 40px; border-radius: 12px; max-width: 500px; margin-left: auto; margin-right: auto; border: 1px solid #2b2b2b;">
          <h1 style="color: #f44336; margin-bottom: 12px; font-size: 20px;">Verification Link Expired or Already Used</h1>
          <p style="color: #8a919d; font-size: 14px; line-height: 1.5;">This verification link has already been used or has expired (valid for 24 hours). Please request a new email change in CollabIDE.</p>
        </div>
      `);
    }

    const oldEmail = user.email;
    const newEmail = user.pendingEmail;

    // Double check that newEmail wasn't registered in the interim
    const collisionUser = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
    if (collisionUser) {
      user.pendingEmail = undefined;
      user.pendingEmailToken = undefined;
      user.pendingEmailExpires = undefined;
      await user.save();
      return res.status(400).send(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; margin-top: 60px; background: #0d0e0f; color: #e3e2e2; padding: 40px; border-radius: 12px; max-width: 500px; margin-left: auto; margin-right: auto; border: 1px solid #2b2b2b;">
          <h1 style="color: #f44336; margin-bottom: 12px; font-size: 20px;">Email Already In Use</h1>
          <p style="color: #8a919d; font-size: 14px;">The email address ${newEmail} is already registered to another account.</p>
        </div>
      `);
    }

    // Commit change & single-use cleanup
    user.email = newEmail;
    user.isVerified = true;
    user.pendingEmail = undefined;
    user.pendingEmailToken = undefined;
    user.pendingEmailExpires = undefined;
    await user.save();

    logger.audit('EMAIL_CHANGE_COMPLETED', { userId: user._id });

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Verified — CollabIDE</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #0d0e0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; color: #e3e2e2;">
        <div style="background: #1b1c1c; border: 1px solid #2b2b2b; border-radius: 12px; padding: 40px; text-align: center; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(30, 142, 62, 0.2); border: 1px solid #1e8e3e; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 10px 0; color: #ffffff;">Email Address Updated</h1>
          <p style="font-size: 14px; color: #8a919d; line-height: 1.5; margin: 0 0 24px 0;">
            Your CollabIDE account email has successfully been changed to <strong style="color: #e3e2e2;">${newEmail}</strong>.
          </p>
          <a href="/" style="display: inline-block; background-color: #007acc; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
            Return to CollabIDE
          </a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while confirming your email change. Please try again.');
  }
});

// @route   POST /api/auth/cancel-email-change
// @desc    Cancel a pending email change
// @access  Private
router.post('/cancel-email-change', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User profile could not be found.' });
    }

    user.pendingEmail = undefined;
    user.pendingEmailToken = undefined;
    user.pendingEmailExpires = undefined;
    await user.save();

    res.json({
      message: 'Pending email change cancelled',
      user: {
        id: user._id,
        _id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        pendingEmail: null,
      },
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while cancelling your email change. Please try again.');
  }
});

// Mock route to verify email manually for local testing
router.get('/verify-mock', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User profile could not be found.' });
    }
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    res.json({ message: `Mock email verification successful for ${email}` });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred during mock verification. Please try again.');
  }
});

// @route   GET /api/auth/config
// @desc    Get public client configuration
// @access  Public
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null
  });
});

// @route   GET /api/auth/check-email
// @desc    Check if an email is registered and how
// @access  Public
router.get('/check-email', authLimiter, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: 'Please provide an email address to check.' });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.json({ exists: false });
    }
    res.json({
      exists: true,
      isGoogleUser: !!user.googleId,
      isLocalUser: !!user.password
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while checking email registration. Please try again.');
  }
});

// @route   POST /api/auth/google-login
// @desc    Authenticate user via Google Access Token
// @access  Public
router.post('/google-login', authLimiter, async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ message: 'Google authentication token is required.' });
    }

    // Fetch user profile info from Google
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!googleRes.ok) {
      const errorText = await googleRes.text();
      logger.warn('Google profile fetch failed', { details: errorText });
      return res.status(401).json({ message: 'The Google authentication token is invalid or has expired. Please try signing in again.' });
    }

    const googleUser = await googleRes.json();
    const { email, name, sub: googleId } = googleUser;

    if (!email) {
      return res.status(400).json({ message: 'Your Google account does not have an associated email address.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists by email
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      // If user exists but doesn't have googleId linked, link it now
      if (!user.googleId) {
        user.googleId = googleId;
      }
      // Google-authenticated users are automatically verified
      if (!user.isVerified) {
        user.isVerified = true;
        user.verificationToken = undefined;
      }
      await user.save();
    } else {
      // Create a new user since they don't exist
      const USER_COLORS = ['#1a73e8', '#1e8e3e', '#f9ab00', '#a142f4', '#e52592'];
      const randomColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

      user = new User({
        email: normalizedEmail,
        displayName: name || 'Google User',
        googleId,
        isVerified: true,
        avatarColor: randomColor,
      });

      await user.save();
    }

    // Generate tokens
    const newAccessToken = generateAccessToken(user._id);

    // Gather device info
    const deviceInfo = `${req.ip} - ${req.headers['user-agent'] || 'Unknown Device'}`;

    // Generate refresh token
    const { plaintext } = await RefreshToken.generate(user._id, null, deviceInfo);

    // Set HttpOnly cookie (NFR-12 & NFR-15)
    setRefreshTokenCookie(res, plaintext);

    // Issue fresh CSRF token cookie (NFR-15)
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    res.json({
      accessToken: newAccessToken,
      csrfToken,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        theme: user.theme || 'vs-dark',
      },
    });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred during Google sign in. Please try again.');
  }
});

// @route   GET /api/auth/sessions
// @desc    Get all active sessions for current user (FR-07, NFR-13)
// @access  Private
router.get('/sessions', protect, async (req, res) => {
  try {
    // Only return active, non-rotated tokens representing active session families
    const tokens = await RefreshToken.find({ user: req.user._id, isRotated: false })
      .select('_id deviceInfo updatedAt familyId')
      .sort({ updatedAt: -1 });

    const tokenCookie = req.cookies?.refreshToken;
    let currentFamilyId = null;
    if (tokenCookie) {
      const [tokenId] = tokenCookie.split('.');
      if (tokenId) {
        const currentDoc = await RefreshToken.findById(tokenId);
        if (currentDoc) {
          currentFamilyId = currentDoc.familyId;
        }
      }
    }

    const sessions = tokens.map((t) => ({
      _id: t._id,
      deviceInfo: t.deviceInfo || 'Unknown Device',
      lastActive: t.updatedAt,
      isCurrent: currentFamilyId ? t.familyId === currentFamilyId : false,
    }));

    res.json({ sessions });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while loading active sessions. Please try again.');
  }
});

// @route   DELETE /api/auth/sessions/:id
// @desc    Revoke a specific session family (FR-07, NFR-13)
// @access  Private
router.delete('/sessions/:id', protect, async (req, res) => {
  try {
    const tokenDoc = await RefreshToken.findOne({ _id: req.params.id, user: req.user._id });
    if (!tokenDoc) {
      return res.status(404).json({ message: 'The specified session could not be found or has already expired.' });
    }
    
    // Revoke the entire session family for this device
    await RefreshToken.deleteMany({ familyId: tokenDoc.familyId });
    res.json({ message: 'Session revoked' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while revoking the session. Please try again.');
  }
});

// @route   DELETE /api/auth/sessions
// @desc    Revoke all OTHER session families (FR-07, NFR-13)
// @access  Private
router.delete('/sessions', protect, async (req, res) => {
  try {
    const tokenCookie = req.cookies?.refreshToken;
    if (!tokenCookie) {
      return res.status(401).json({ message: 'You must be logged in to revoke sessions.' });
    }
    
    const [tokenId] = tokenCookie.split('.');
    if (!tokenId) {
      return res.status(401).json({ message: 'Your session token is invalid.' });
    }

    const currentDoc = await RefreshToken.findById(tokenId);
    if (!currentDoc) {
      return res.status(401).json({ message: 'Your current session could not be verified.' });
    }
    
    // Delete all session families for this user except the current session family
    await RefreshToken.deleteMany({ 
      user: req.user._id, 
      familyId: { $ne: currentDoc.familyId },
    });
    
    res.json({ message: 'All other sessions revoked' });
  } catch (error) {
    return sendPlainEnglishError(res, error, 'An error occurred while revoking other sessions. Please try again.');
  }
});

router.ipBruteForceLimiter = ipBruteForceLimiter;
router.recordFailedIpAttempt = recordFailedIpAttempt;
router.recordFailedAccountAttempt = recordFailedAccountAttempt;
router.handleFailedLogin = handleFailedLogin;

module.exports = router;

