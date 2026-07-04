const mongoose = require('mongoose');
const crypto = require('crypto');

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
    deviceInfo: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Hash function helper
refreshTokenSchema.statics.hashToken = function (tokenStr) {
  return crypto.createHash('sha256').update(tokenStr).digest('hex');
};

// Generate a random token and return both the plaintext and hashed schema details
refreshTokenSchema.statics.generate = function (userId, familyId = null, deviceInfo = null) {
  const plaintext = crypto.randomBytes(40).toString('hex');
  const hashed = crypto.createHash('sha256').update(plaintext).digest('hex');
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

  return { plaintext, tokenDoc };
};

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = RefreshToken;
