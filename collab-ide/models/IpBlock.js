/**
 * @file models/IpBlock.js
 * @module models/IpBlock
 * @description Mongoose model for IP address brute-force tracking and temporary banning (NFR-14, NFR-22).
 * 
 * Tracks:
 * - Client IP addresses and consecutive failed authentication attempts
 * - Sensitive field encryption at rest: IP address logs are encrypted using AES-256-GCM (NFR-22)
 * - Deterministic HMAC-SHA256 blind indexing (`ipHash`) for fast O(1) IP lookups
 * - Temporary block window (`blockUntil`)
 * - MongoDB TTL index expiring entries automatically after 1 hour (3600s) of inactivity
 */

const mongoose = require('mongoose');
const { encrypt, decrypt, isEncrypted, hashBlindIndex } = require('../utils/encryption');

const ipBlockSchema = new mongoose.Schema(
  {
    // NFR-22: Client IP address encrypted at rest using AES-256-GCM
    ip: {
      type: String,
      required: true,
      trim: true,
    },
    // NFR-22: HMAC-SHA256 blind index for exact-match equality lookups
    ipHash: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
    },
    failedAttempts: {
      type: Number,
      required: true,
      default: 0,
    },
    // NFR-14: 10-minute sliding window start for IP failed attempts
    windowStart: {
      type: Date,
    },
    blockUntil: {
      type: Date,
    },
    // Housekeeping TTL index: removes inactive tracking documents after 24 hours (86400s)
    updatedAt: {
      type: Date,
      default: Date.now,
      index: { expires: 86400 },
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-validation hook to ensure blind index is set.
 */
ipBlockSchema.pre('validate', function () {
  if (this.ip && typeof this.ip === 'string' && !isEncrypted(this.ip)) {
    this.ip = this.ip.trim();
    this.ipHash = hashBlindIndex(this.ip);
  }
});

/**
 * Pre-save middleware:
 * 1. Resets TTL timestamp.
 * 2. Encrypts client IP address using AES-256-GCM before writing to MongoDB (NFR-22).
 */
ipBlockSchema.pre('save', function () {
  this.updatedAt = new Date();

  if (this.isModified('ip') && this.ip) {
    if (!isEncrypted(this.ip)) {
      this.ipHash = hashBlindIndex(this.ip);
      this.ip = encrypt(this.ip);
    } else if (!this.ipHash) {
      this.ipHash = hashBlindIndex(decrypt(this.ip));
    }
  }
});

/**
 * Post-save hook: Decrypts IP address in-memory.
 */
ipBlockSchema.post('save', function () {
  if (this.ip && isEncrypted(this.ip)) {
    this.ip = decrypt(this.ip);
  }
});

/**
 * Post-init hook: Decrypts IP address upon document hydration from MongoDB.
 */
ipBlockSchema.post('init', function () {
  if (this.ip && isEncrypted(this.ip)) {
    this.ip = decrypt(this.ip);
  }
});

/**
 * Pre-query hook: Rewrites queries searching by `ip` to use `ipHash` for O(1) indexed lookups.
 */
function transformIpQuery() {
  const filter = this.getFilter();
  if (!filter) return;

  if (filter.ip !== undefined && typeof filter.ip === 'string') {
    const rawIp = filter.ip;
    if (!isEncrypted(rawIp)) {
      const h = hashBlindIndex(rawIp);
      delete filter.ip;
      const condition = {
        $or: [
          { ipHash: h },
          { ip: rawIp.trim() },
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

ipBlockSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], transformIpQuery);

ipBlockSchema.statics.transformQuery = transformIpQuery;

/**
 * Static lookup helper to retrieve an IP block record by plaintext IP.
 *
 * @function findByIp
 * @memberof module:models/IpBlock
 * @param {string} ip - Client IP address
 * @returns {Promise<import('./IpBlock').IpBlockDocument|null>} Matching record or null
 */
ipBlockSchema.statics.findByIp = function (ip) {
  if (!ip) return null;
  const h = hashBlindIndex(ip);
  return this.findOne({
    $or: [{ ipHash: h }, { ip: ip.trim() }],
  });
};

const IpBlock = mongoose.model('IpBlock', ipBlockSchema);

module.exports = IpBlock;
