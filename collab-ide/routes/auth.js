const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const IpBlock = require('../models/IpBlock');
const { privateKey } = require('../utils/keys');
const { protect } = require('../middleware/auth'); // We will export it from middleware/auth.js

const router = express.Router();

// Password complexity regex
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// Rate limiters (NFR-14 & NFR-35)
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute (per NFR-35)
  max: 10, // Max 10 requests per window
  message: { message: 'Too many authentication requests, please try again after 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || process.env.NODE_ENV === 'test';
  }, // Skip for local development/testing loops
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

// Helper: Generate JWT access token (15 mins expiry, RS256)
function generateAccessToken(userId) {
  return jwt.sign({ userId, type: 'access' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
  });
}

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, displayName, avatarColor } = req.body;

    if (!email || !password || !displayName) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Validate password complexity
    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
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

    // Print verification email content to console (FR-01 mock fallback)
    const verificationLink = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${verificationToken}`;
    console.log('\n✉️  [MOCK EMAIL] Verification email sent:');
    console.log(`    To: ${email}`);
    console.log(`    Link: ${verificationLink}\n`);

    res.status(201).json({
      message: 'Registration successful. Please verify your email to activate your account. Verification link has been logged to the server console.',
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/auth/verify
// @desc    Verify email address
// @access  Public
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ message: 'Verification token is required' });
    }

    const user = await User.findOne({ verificationToken: token });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    // Send a simple HTML success page
    res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h1 style="color: #a6e3a1;">Verification Successful! 🎉</h1>
        <p>Your email has been verified. You can now close this tab and log in to Collide.</p>
      </div>
    `);
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// IP Brute Force Limiter Middleware
const ipBruteForceLimiter = async (req, res, next) => {
  try {
    const ip = req.ip;
    const ipBlock = await IpBlock.findOne({ ip });
    
    if (ipBlock && ipBlock.blockUntil && ipBlock.blockUntil > new Date()) {
      return res.status(429).json({
        message: 'Too many failed login attempts from this IP. Please try again in 1 hour.',
      });
    }
    next();
  } catch (error) {
    console.error('IP block check error:', error);
    next();
  }
};

const handleFailedLogin = async (req, user, ipBlockDoc) => {
  const ip = req.ip;

  // Increment IP block counter
  if (ipBlockDoc) {
    ipBlockDoc.failedAttempts += 1;
    if (ipBlockDoc.failedAttempts >= 20) {
      ipBlockDoc.blockUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    }
    await ipBlockDoc.save();
  } else {
    await IpBlock.create({ ip, failedAttempts: 1 });
  }

  // Increment User lock counter
  if (user) {
    user.loginAttempts += 1;
    if (user.loginAttempts >= 5) {
      user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      
      // Send mock email
      console.log('\n🚨  [MOCK EMAIL] Account Temporarily Locked:');
      console.log(`    To: ${user.email}`);
      console.log(`    Message: Your account has been locked for 15 minutes due to 5 consecutive failed login attempts.\n`);
    }
    await user.save();
  }
};

// @route   POST /api/auth/login
// @desc    Authenticate user & get tokens
// @access  Public
router.post('/login', authLimiter, ipBruteForceLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Pre-fetch IP block doc to track failed attempts
    const ipBlockDoc = await IpBlock.findOne({ ip: req.ip });

    const user = await User.findOne({ email });
    if (!user) {
      await handleFailedLogin(req, null, ipBlockDoc);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > new Date()) {
      const lockMins = Math.ceil((user.lockUntil - new Date()) / 60000);
      return res.status(403).json({ message: `Account is temporarily locked due to multiple failed attempts. Please try again in ${lockMins} minutes.` });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await handleFailedLogin(req, user, ipBlockDoc);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email address first' });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0 || user.lockUntil) {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    
    // Gather device info
    const deviceInfo = `${req.ip} - ${req.headers['user-agent'] || 'Unknown Device'}`;
    
    // Generate refresh token (returns plaintext + tokenDoc instance)
    const { plaintext, tokenDoc } = await RefreshToken.generate(user._id, null, deviceInfo);
    await tokenDoc.save();

    // Set HttpOnly cookie (FR-02 & NFR-12)
    res.cookie('refreshToken', plaintext, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      accessToken,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/refresh
// @desc    Rotate and issue new tokens
// @access  Public (uses cookie)
router.post('/refresh', async (req, res) => {
  try {
    const tokenCookie = req.cookies.refreshToken;
    if (!tokenCookie) {
      return res.status(401).json({ message: 'No refresh token provided' });
    }

    const [tokenId, tokenSecret] = tokenCookie.split('.');
    if (!tokenId || !tokenSecret) {
      return res.status(401).json({ message: 'Invalid refresh token format' });
    }

    const storedToken = await RefreshToken.findById(tokenId);

    if (!storedToken) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const isMatch = await bcrypt.compare(tokenSecret, storedToken.token);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid refresh token signature' });
    }

    // Replay attack check: If token is already marked as rotated, reject and invalidate family
    if (storedToken.isRotated) {
      console.warn(`🚨 Replay attack detected! Invaliding token family: ${storedToken.familyId}`);
      await RefreshToken.deleteMany({ familyId: storedToken.familyId });
      res.clearCookie('refreshToken');
      return res.status(403).json({ message: 'Access denied. Refresh token reuse detected.' });
    }

    // Expiry check
    if (storedToken.expiresAt < new Date()) {
      await storedToken.deleteOne();
      res.clearCookie('refreshToken');
      return res.status(401).json({ message: 'Refresh token expired' });
    }

    // Mark current token as rotated
    storedToken.isRotated = true;
    await storedToken.save();

    // Generate new refresh token in same family
    const deviceInfo = `${req.ip} - ${req.headers['user-agent'] || 'Unknown Device'}`;
    const { plaintext, tokenDoc } = await RefreshToken.generate(storedToken.user, storedToken.familyId, deviceInfo);
    await tokenDoc.save();

    // Generate new access token
    const accessToken = generateAccessToken(storedToken.user);

    // Update cookie
    res.cookie('refreshToken', plaintext, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ accessToken });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout and revoke active session
// @access  Public (authenticated via cookie)
router.post('/logout', async (req, res) => {
  try {
    const tokenCookie = req.cookies.refreshToken;
    if (tokenCookie) {
      const [tokenId] = tokenCookie.split('.');
      if (tokenId) {
        await RefreshToken.findByIdAndDelete(tokenId);
      }
    }
    
    res.clearCookie('refreshToken');
    res.json({ message: 'Successfully logged out' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/logout-all
// @desc    Revoke all sessions for user
// @access  Private
router.post('/logout-all', protect, async (req, res) => {
  try {
    await RefreshToken.deleteMany({ user: req.user._id });
    res.clearCookie('refreshToken');
    res.json({ message: 'Successfully logged out from all devices' });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// @route   POST /api/auth/reset-password-request
// @desc    Request a password reset link (FR-09)
// @access  Public
router.post('/reset-password-request', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Email is required' });
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

    console.log('\n🔑  [MOCK EMAIL] Password Reset Link:');
    console.log(`    To: ${normalizedEmail}`);
    console.log(`    Link: ${resetLink}`);
    console.log(`    Expires: 30 minutes (Single-use)\n`);

    res.json(successMsg);
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/auth/reset-password/validate
// @desc    Validate a password reset token before displaying the form (FR-09)
// @access  Public
router.get('/reset-password/validate', authLimiter, async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ valid: false, message: 'Reset token is required' });
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
    console.error('Validate reset token error:', error);
    res.status(500).json({ valid: false, message: 'Server error' });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Execute password reset (FR-09)
// @access  Public
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid, already used, or expired reset token. Reset links are single-use and expire after 30 minutes.' });
    }

    // Validate password complexity (FR-01 / FR-09)
    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
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
    res.clearCookie('refreshToken');

    console.log(`\n🔒 [PASSWORD RESET] Password successfully reset for user ${user.email}. All refresh tokens revoked.\n`);

    res.json({ message: 'Password has been reset successfully. All active sessions have been revoked.' });
  } catch (error) {
    console.error('Password reset execution error:', error);
    res.status(500).json({ message: 'Server error' });
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
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        isVerified: user.isVerified,
        pendingEmail: user.pendingEmail || null,
        pendingEmailExpires: user.pendingEmailExpires || null,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user display name and/or avatar color (FR-08)
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { displayName, avatarColor } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || !displayName.trim()) {
        return res.status(400).json({ message: 'Display name cannot be empty' });
      }
      if (displayName.trim().length > 50) {
        return res.status(400).json({ message: 'Display name must be 50 characters or less' });
      }
      user.displayName = displayName.trim();
    }

    if (avatarColor !== undefined) {
      const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;
      if (typeof avatarColor !== 'string' || !HEX_COLOR_REGEX.test(avatarColor)) {
        return res.status(400).json({ message: 'Avatar color must be a valid 6-digit hex code (e.g. #1a73e8)' });
      }
      user.avatarColor = avatarColor;
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
        isVerified: user.isVerified,
        pendingEmail: user.pendingEmail || null,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
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
      return res.status(400).json({ message: 'New email address is required' });
    }

    const normalizedEmail = newEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Invalid email address format' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.email.toLowerCase() === normalizedEmail) {
      return res.status(400).json({ message: 'New email must be different from current email' });
    }

    // Check if new email is already registered to another user (case-normalized)
    const existingUser = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: user._id },
    });
    if (existingUser) {
      return res.status(400).json({ message: 'This email address is already registered to another account' });
    }

    // Check if new email is pending verification for another user
    const existingPending = await User.findOne({
      pendingEmail: normalizedEmail,
      _id: { $ne: user._id },
      pendingEmailExpires: { $gt: new Date() },
    });
    if (existingPending) {
      return res.status(400).json({ message: 'This email address is already pending verification for another account' });
    }

    // Generate secure random token and SHA-256 hash at rest
    const plaintextToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plaintextToken).digest('hex');

    user.pendingEmail = normalizedEmail;
    user.pendingEmailToken = tokenHash;
    user.pendingEmailExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await user.save();

    // Security Alert to current email
    console.log('\n🛡️  [SECURITY ALERT] Email Change Requested:');
    console.log(`    To (Current Account Email): ${user.email}`);
    console.log(`    Notice: A request was made to change your CollabIDE account email to "${normalizedEmail}". If you did not make this request, please secure your account immediately.\n`);

    // Verification link for new email
    const verificationLink = `${req.protocol}://${req.get('host')}/api/auth/verify-email-change?token=${plaintextToken}`;
    console.log('✉️  [MOCK EMAIL] Verification Link for New Email:');
    console.log(`    To (New Email): ${normalizedEmail}`);
    console.log(`    Link: ${verificationLink}\n`);

    res.json({
      message: 'Verification link sent to new email address. Please check your inbox (or server console) to confirm.',
      pendingEmail: normalizedEmail,
      pendingEmailExpires: user.pendingEmailExpires,
    });
  } catch (error) {
    console.error('Change email error:', error);
    res.status(500).json({ message: 'Server error' });
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
          <p style="color: #8a919d; font-size: 14px;">Verification token is missing.</p>
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

    console.log(`\n✅ [EMAIL CHANGED] User ${user._id} email updated from ${oldEmail} to ${newEmail}.\n`);

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
    console.error('Verify email change error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/cancel-email-change
// @desc    Cancel a pending email change
// @access  Private
router.post('/cancel-email-change', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
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
    console.error('Cancel email change error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mock route to verify email manually for local testing
router.get('/verify-mock', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    res.json({ message: `Mock email verification successful for ${email}` });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/auth/config
// @desc    Get public client configuration
// @access  Public
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '1017941060498-95godc626a0qvjsfpegp9dthnnafs5j6.apps.googleusercontent.com'
  });
});

// @route   GET /api/auth/check-email
// @desc    Check if an email is registered and how
// @access  Public
router.get('/check-email', authLimiter, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
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
    console.error('Check email error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/google-login
// @desc    Authenticate user via Google Access Token
// @access  Public
router.post('/google-login', authLimiter, async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ message: 'Access token is required' });
    }

    // Fetch user profile info from Google
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!googleRes.ok) {
      const errorText = await googleRes.text();
      console.error('Google profile fetch failed:', errorText);
      return res.status(401).json({ message: 'Invalid Google access token' });
    }

    const googleUser = await googleRes.json();
    const { email, name, sub: googleId } = googleUser;

    if (!email) {
      return res.status(400).json({ message: 'Google account is missing an email address' });
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
    const { plaintext, tokenDoc } = RefreshToken.generate(user._id, null, deviceInfo);
    await tokenDoc.save();

    // Set HttpOnly cookie
    res.cookie('refreshToken', plaintext, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      accessToken: newAccessToken,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/auth/sessions
// @desc    Get all active sessions for current user (FR-07)
// @access  Private
router.get('/sessions', protect, async (req, res) => {
  try {
    const tokens = await RefreshToken.find({ user: req.user._id, isRotated: false })
      .select('_id deviceInfo updatedAt token')
      .sort({ updatedAt: -1 });

    const { refreshToken } = req.cookies;
    let hashedToken = null;
    if (refreshToken) {
      hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    }

    const sessions = tokens.map(t => ({
      _id: t._id,
      deviceInfo: t.deviceInfo || 'Unknown Device',
      lastActive: t.updatedAt,
      isCurrent: hashedToken === t.token
    }));

    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/auth/sessions/:id
// @desc    Revoke a specific session (FR-07)
// @access  Private
router.delete('/sessions/:id', protect, async (req, res) => {
  try {
    const tokenDoc = await RefreshToken.findOne({ _id: req.params.id, user: req.user._id });
    if (!tokenDoc) {
      return res.status(404).json({ message: 'Session not found' });
    }
    
    await RefreshToken.deleteOne({ _id: req.params.id });
    res.json({ message: 'Session revoked' });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/auth/sessions
// @desc    Revoke all OTHER sessions (FR-07)
// @access  Private
router.delete('/sessions', protect, async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    // Delete all tokens for this user that are NOT the current one
    await RefreshToken.deleteMany({ 
      user: req.user._id, 
      token: { $ne: hashedToken } 
    });
    
    res.json({ message: 'All other sessions revoked' });
  } catch (error) {
    console.error('Revoke all sessions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
