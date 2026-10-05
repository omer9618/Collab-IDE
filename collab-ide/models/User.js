/**
 * @file models/User.js
 * @module models/User
 * @description Mongoose model for User accounts and authentication credentials.
 * 
 * Features:
 * - Email and password credentials with Bcrypt (cost factor 12) pre-save hashing (FR-01, NFR-16)
 * - Sensitive field encryption at rest: `email` and `pendingEmail` are encrypted using AES-256-GCM (NFR-22)
 * - Deterministic HMAC-SHA256 blind indexing (`emailHash`, `pendingEmailHash`) for fast, O(1) indexed queries
 * - Email verification state and token tracking
 * - Dual-layer brute force lockout state (`loginAttempts`, `lockUntil`) (NFR-14)
 * - Password reset tokens and expiry tracking (FR-09)
 * - Pending email change staging and confirmation tokens (FR-08)
 * - Theme selection persistence per user across sessions (FR-24)
 * - Google OAuth identity binding (FR-02)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { encrypt, decrypt, isEncrypted, hashBlindIndex } = require('../utils/encryption');

const userSchema = new mongoose.Schema(
  {
    // NFR-22: Email address encrypted at rest using AES-256-GCM
    email: {
      type: String,
      required: true,
      trim: true,
    },
    // NFR-22: HMAC-SHA256 blind index for exact-match equality searches without decrypting
    emailHash: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
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
    // NFR-22: Staged new email encrypted at rest using AES-256-GCM
    pendingEmail: {
      type: String,
      trim: true,
    },
    // NFR-22: Blind index for pending email address uniqueness checks
    pendingEmailHash: {
      type: String,
      index: true,
      sparse: true,
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
    // NFR-14: 10-minute sliding window start for account lockout
    loginAttemptsWindowStart: {
      type: Date,
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
 * Pre-validation middleware to normalize plaintext emails and compute blind indexes.
 */
userSchema.pre('validate', function () {
  if (this.email && typeof this.email === 'string' && !isEncrypted(this.email)) {
    this.email = this.email.toLowerCase().trim();
    this.emailHash = hashBlindIndex(this.email);
  }
  if (this.pendingEmail && typeof this.pendingEmail === 'string' && !isEncrypted(this.pendingEmail)) {
    this.pendingEmail = this.pendingEmail.toLowerCase().trim();
    this.pendingEmailHash = hashBlindIndex(this.pendingEmail);
  }
});

/**
 * Pre-save middleware:
 * 1. Hashes modified passwords using Bcrypt with salt cost 12 (FR-01, NFR-16).
 * 2. Encrypts sensitive email fields using AES-256-GCM before writing to MongoDB (NFR-22).
 */
userSchema.pre('save', async function () {
  const user = this;

  // Password hashing (FR-01, NFR-16)
  if (user.isModified('password') && user.password) {
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(user.password, salt);
  }

  // NFR-22: Email address encryption at rest using AES-256-GCM
  if (user.isModified('email') && user.email) {
    if (!isEncrypted(user.email)) {
      user.emailHash = hashBlindIndex(user.email);
      user.email = encrypt(user.email);
    } else if (!user.emailHash) {
      user.emailHash = hashBlindIndex(decrypt(user.email));
    }
  }

  // NFR-22: Pending email address encryption at rest using AES-256-GCM
  if (user.isModified('pendingEmail')) {
    if (user.pendingEmail && !isEncrypted(user.pendingEmail)) {
      user.pendingEmailHash = hashBlindIndex(user.pendingEmail);
      user.pendingEmail = encrypt(user.pendingEmail);
    } else if (!user.pendingEmail) {
      user.pendingEmailHash = undefined;
    }
  }
});

/**
 * Post-save hook: Decrypts fields in-memory so subsequent controller operations work seamlessly.
 */
userSchema.post('save', function () {
  if (this.email && isEncrypted(this.email)) {
    this.email = decrypt(this.email);
  }
  if (this.pendingEmail && isEncrypted(this.pendingEmail)) {
    this.pendingEmail = decrypt(this.pendingEmail);
  }
});

/**
 * Post-init hook: Decrypts AES-256-GCM fields upon document hydration from MongoDB.
 */
userSchema.post('init', function () {
  if (this.email && isEncrypted(this.email)) {
    this.email = decrypt(this.email);
  }
  if (this.pendingEmail && isEncrypted(this.pendingEmail)) {
    this.pendingEmail = decrypt(this.pendingEmail);
  }
});

/**
 * Pre-query hook: Automatically rewrites equality queries on `email` and `pendingEmail`
 * to leverage the HMAC-SHA256 blind index for O(1) indexed lookups (NFR-22).
 */
function transformUserQuery() {
  const filter = this.getFilter();
  if (!filter) return;

  if (filter.email !== undefined && typeof filter.email === 'string') {
    const rawEmail = filter.email;
    if (!isEncrypted(rawEmail)) {
      const emailH = hashBlindIndex(rawEmail);
      delete filter.email;
      const condition = {
        $or: [
          { emailHash: emailH },
          { email: rawEmail.toLowerCase().trim() },
        ],
      };
      if (!filter.$or && !filter.$and) {
        filter.$or = condition.$or;
      } else {
        filter.$and = filter.$and || [];
        filter.$and.push(condition);
      }
    }
  }

  if (filter.pendingEmail !== undefined && typeof filter.pendingEmail === 'string') {
    const rawPending = filter.pendingEmail;
    if (!isEncrypted(rawPending)) {
      const pendingH = hashBlindIndex(rawPending);
      delete filter.pendingEmail;
      const condition = {
        $or: [
          { pendingEmailHash: pendingH },
          { pendingEmail: rawPending.toLowerCase().trim() },
        ],
      };
      if (!filter.$or && !filter.$and) {
        filter.$or = condition.$or;
      } else {
        filter.$and = filter.$and || [];
        filter.$and.push(condition);
      }
    }
  }
}

userSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], transformUserQuery);

userSchema.statics.transformQuery = transformUserQuery;

/**
 * Static lookup helper to retrieve a user document by plaintext email address.
 *
 * @function findByEmail
 * @memberof module:models/User
 * @param {string} email - Plaintext email address to look up
 * @returns {Promise<import('./User').UserDocument|null>} Matching user document or null
 */
userSchema.statics.findByEmail = function (email) {
  if (!email) return null;
  const emailH = hashBlindIndex(email);
  return this.findOne({
    $or: [{ emailHash: emailH }, { email: email.toLowerCase().trim() }],
  });
};

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
