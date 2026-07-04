const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { privateKey } = require('../utils/keys');
const { protect } = require('../middleware/auth'); // We will export it from middleware/auth.js

const router = express.Router();

// Password complexity regex
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

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
        <p>Your email has been verified. You can now close this tab and log in to CollabIDE.</p>
      </div>
    `);
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get tokens
// @access  Public
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email address first' });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    
    // Gather device info
    const deviceInfo = `${req.ip} - ${req.headers['user-agent'] || 'Unknown Device'}`;
    
    // Generate refresh token (returns plaintext + tokenDoc instance)
    const { plaintext, tokenDoc } = RefreshToken.generate(user._id, null, deviceInfo);
    await tokenDoc.save();

    // Set HttpOnly cookie (FR-02)
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

    const hashedToken = RefreshToken.hashToken(tokenCookie);
    const storedToken = await RefreshToken.findOne({ token: hashedToken });

    if (!storedToken) {
      return res.status(401).json({ message: 'Invalid refresh token' });
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
    const { plaintext, tokenDoc } = RefreshToken.generate(storedToken.user, storedToken.familyId, deviceInfo);
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
      const hashedToken = RefreshToken.hashToken(tokenCookie);
      await RefreshToken.deleteOne({ token: hashedToken });
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

// @route   GET /api/auth/sessions
// @desc    View all active sessions for the user
// @access  Private
router.get('/sessions', protect, async (req, res) => {
  try {
    const sessions = await RefreshToken.find({
      user: req.user._id,
      expiresAt: { $gt: new Date() },
      isRotated: false,
    }).select('createdAt deviceInfo');

    res.json(sessions);
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/auth/sessions/:id
// @desc    Revoke specific session by token ID
// @access  Private
router.delete('/sessions/:id', protect, async (req, res) => {
  try {
    const tokenDoc = await RefreshToken.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!tokenDoc) {
      return res.status(404).json({ message: 'Session not found or unauthorized' });
    }

    // Invalidate the session
    await tokenDoc.deleteOne();
    res.json({ message: 'Session successfully revoked' });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/reset-password-request
// @desc    Request a password reset link
// @access  Public
router.post('/reset-password-request', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    // Generic response to prevent enumeration
    const successMsg = { message: 'If the email matches a registered account, a password reset link has been logged to the console.' };

    if (!user) {
      return res.json(successMsg);
    }

    const resetToken = require('crypto').randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
    await user.save();

    const resetLink = `${req.protocol}://${req.get('host')}/api/auth/reset-password?token=${resetToken}`;
    console.log('\n🔑  [MOCK EMAIL] Password Reset Link:');
    console.log(`    To: ${email}`);
    console.log(`    Link: ${resetLink}\n`);

    res.json(successMsg);
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Execute password reset
// @access  Public
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Validate password complexity
    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Revoke all active sessions upon password reset (FR-09)
    await RefreshToken.deleteMany({ user: user._id });

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
    const user = await User.findById(req.user._id).select('-password -verificationToken -resetPasswordToken -resetPasswordExpires');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarColor: user.avatarColor
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
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

module.exports = router;
