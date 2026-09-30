const mongoose = require('mongoose');

const ipBlockSchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    failedAttempts: {
      type: Number,
      required: true,
      default: 0,
    },
    blockUntil: {
      type: Date,
    },
    // TTL index to automatically remove documents after 1 hour (3600 seconds) of inactivity
    // This keeps the collection clean from stale IPs.
    updatedAt: {
      type: Date,
      default: Date.now,
      index: { expires: 3600 },
    },
  },
  {
    timestamps: true,
  }
);

// Update `updatedAt` on save to reset TTL
ipBlockSchema.pre('save', function () {
  this.updatedAt = new Date();
});

const IpBlock = mongoose.model('IpBlock', ipBlockSchema);

module.exports = IpBlock;
