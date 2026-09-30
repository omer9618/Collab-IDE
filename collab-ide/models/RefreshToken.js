/**
 * @file models/RefreshToken.js
 * @module models/RefreshToken
 * @description Mongoose model for Refresh Token Rotation (RTR) and session management.
 * 
 * Implements:
 * - 7-day refresh token lifecycle with cryptographic random hex generation (FR-02)
 * - Token family grouping (`familyId`) for automatic token reuse detection (NFR-12, NFR-13)
 * - Bcrypt hashing of stored refresh tokens to prevent token compromise on database exposure
 * - Sensitive session metadata (`deviceInfo`) encrypted at rest using AES-256-GCM (NFR-22)
 * - Device metadata tracking for remote session revocation (FR-07)
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');

const refreshTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    isRotated: {
      type: Boolean,
      default: false,
    },
    // NFR-22: Session metadata (IP and User-Agent) encrypted at rest using AES-256-GCM
    deviceInfo: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-save middleware: Encrypts session metadata using AES-256-GCM before writing to MongoDB (NFR-22).
 */
refreshTokenSchema.pre('save', function () {
  if (this.isModified('deviceInfo') && this.deviceInfo) {
    if (!isEncrypted(this.deviceInfo)) {
      this.deviceInfo = encrypt(this.deviceInfo);
    }
  }
});

/**
 * Post-save hook: Decrypts session metadata in-memory after persistence.
 */
refreshTokenSchema.post('save', function () {
  if (this.deviceInfo && isEncrypted(this.deviceInfo)) {
    this.deviceInfo = decrypt(this.deviceInfo);
  }
});

/**
 * Post-init hook: Decrypts session metadata upon document hydration from MongoDB.
 */
refreshTokenSchema.post('init', function () {
  if (this.deviceInfo && isEncrypted(this.deviceInfo)) {
    this.deviceInfo = decrypt(this.deviceInfo);
  }
});

/**
 * SHA-256 token hashing helper for backward compatibility.
 *
 * @function hashToken
 * @param {string} tokenStr - Raw token string
 * @returns {string} SHA-256 hex digest
 */
refreshTokenSchema.statics.hashToken = function (tokenStr) {
  return crypto.createHash('sha256').update(tokenStr).digest('hex');
};

/**
 * Generates an opaque, cryptographically random refresh token (7-day validity) and hashes it with Bcrypt.
 *
 * SECURITY REASONING (NFR-12, NFR-13, NFR-22):
 * Generates 40 bytes of secure cryptographic entropy. The token string is hashed before
 * database storage, ensuring stolen database backups cannot be leveraged to hijack active sessions.
 * Maintains token family association to invalidate all sibling tokens if reuse is detected.
 * Encrypts device metadata with AES-256-GCM to prevent exposure of client IPs and user-agent strings.
 *
 * @async
 * @function generate
 * @memberof module:models/RefreshToken
 * @param {string|import('mongoose').Types.ObjectId} userId - User ID owner
 * @param {string|null} [familyId=null] - Existing family ID if rotating, or null to generate a new family
 * @param {string|null} [deviceInfo=null] - User-Agent device string
 * @returns {Promise<{ plaintext: string, doc: import('mongoose').Document, tokenDoc: import('mongoose').Document }>} Plaintext token and saved document
 */
refreshTokenSchema.statics.generate = async function (userId, familyId = null, deviceInfo = null) {
  const plaintext = crypto.randomBytes(40).toString('hex');
  const hashed = await bcrypt.hash(plaintext, 10);
  const tokenFamily = familyId || crypto.randomUUID();
  
  // Set expiry to 7 days from now (per FR-02)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  const tokenDoc = new this({
    token: hashed,
    user: userId,
    expiresAt,
    familyId: tokenFamily,
    isRotated: false,
    deviceInfo,
  });

  await tokenDoc.save();
  return { plaintext, doc: tokenDoc, tokenDoc };
};

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = RefreshToken;
