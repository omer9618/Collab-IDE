/**
 * @file models/User.js
 * @module models/User
 * @description Mongoose model for User accounts and authentication credentials.
 * 
 * Features:
 * - Email and password credentials with Bcrypt (cost factor 12) pre-save hashing (FR-01, NFR-16)
 * - Email verification state and token tracking
 * - Dual-layer brute force lockout state (`loginAttempts`, `lockUntil`) (NFR-14)
 * - Password reset tokens and expiry tracking (FR-09)
 * - Pending email change staging and confirmation tokens (FR-08)
 * - Theme selection persistence per user across sessions (FR-24)
 * - Google OAuth identity binding (FR-02)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    password: {
      type: String,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    avatarColor: {
      type: String,
      default: '#89b4fa',
    },
    // FR-24: Persisted editor theme selection ('vs-dark' | 'light')
    theme: {
      type: String,
      enum: ['vs-dark', 'light'],
      default: 'vs-dark',
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationToken: {
      type: String,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    pendingEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    pendingEmailToken: {
      type: String,
    },
    pendingEmailExpires: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      required: true,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-save middleware to hash modified passwords using Bcrypt with salt cost 12 (FR-01, NFR-16).
 */
userSchema.pre('save', async function () {
  const user = this;
  if (!user.isModified('password') || !user.password) return;

  const salt = await bcrypt.genSalt(12); // cost factor 12 per FR-01
  user.password = await bcrypt.hash(user.password, salt);
});

/**
 * Compares a plain text candidate password with the stored Bcrypt hash.
 *
 * @async
 * @function comparePassword
 * @memberof module:models/User~UserDocument
 * @param {string} candidatePassword - Plain text password provided during login
 * @returns {Promise<boolean>} True if password matches hash, false otherwise
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
