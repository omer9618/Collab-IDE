/**
 * @file config/db.js
 * @module config/db
 * @description MongoDB database connection establishment and pool sizing (NFR-40).
 */

const mongoose = require('mongoose');

/**
 * Initializes connection to MongoDB with connection pooling configuration.
 *
 * CONFIGURATION & SECURITY (NFR-40):
 * - Pool Size Bounds: `minPoolSize` (default: 5) ensures warm connections are pre-allocated;
 *   `maxPoolSize` (default: 20) bounds concurrent socket utilization, preventing socket starvation.
 * - Timeouts: `serverSelectionTimeoutMS` (5000ms) fails fast on network partitioning;
 *   `socketTimeoutMS` (45000ms) reaps idle connections.
 *
 * @async
 * @function connectDB
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  try {
    const env = overrideEnv || process.env;
    const connUri = env.MONGODB_URI || 'mongodb://127.0.0.1:27017/collabide';
    const config = resolvePoolConfig(env);

    const options = {
      minPoolSize: config.minPoolSize,
      maxPoolSize: config.maxPoolSize,
      maxIdleTimeMS: config.maxIdleTimeMS,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    // Connects Mongoose default singleton instance (NFR-38 compatibility guaranteed)
    const conn = await mongoose.connect(connUri, options);
    console.log(`🔌 MongoDB Connected: ${conn.connection.host}`);
    console.log(
      `⚙️  Mongoose Connection Pool: min=${config.minPoolSize} (${config.sources.minPoolSize}), ` +
      `max=${config.maxPoolSize} (${config.sources.maxPoolSize}), ` +
      `idleTimeout=${config.maxIdleTimeMS}ms (${config.sources.maxIdleTimeMS}) [NFR-40]`
    );

    return conn;
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = {
  connectDB,
  resolvePoolConfig,
};
