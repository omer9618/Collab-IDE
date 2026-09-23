const mongoose = require('mongoose');

/**
 * Resolves database connection pool configuration from environment variables
 * with origin tracking and fail-fast validation (NFR-40).
 */
function resolvePoolConfig(env = process.env) {
  let minPoolSize = 5;
  let minSource = 'default';
  if (env.MONGO_MIN_POOL_SIZE !== undefined && env.MONGO_MIN_POOL_SIZE !== '') {
    minPoolSize = parseInt(env.MONGO_MIN_POOL_SIZE, 10);
    minSource = 'MONGO_MIN_POOL_SIZE';
  } else if (env.DB_MIN_POOL_SIZE !== undefined && env.DB_MIN_POOL_SIZE !== '') {
    minPoolSize = parseInt(env.DB_MIN_POOL_SIZE, 10);
    minSource = 'DB_MIN_POOL_SIZE';
  }

  let maxPoolSize = 20;
  let maxSource = 'default';
  if (env.MONGO_MAX_POOL_SIZE !== undefined && env.MONGO_MAX_POOL_SIZE !== '') {
    maxPoolSize = parseInt(env.MONGO_MAX_POOL_SIZE, 10);
    maxSource = 'MONGO_MAX_POOL_SIZE';
  } else if (env.DB_MAX_POOL_SIZE !== undefined && env.DB_MAX_POOL_SIZE !== '') {
    maxPoolSize = parseInt(env.DB_MAX_POOL_SIZE, 10);
    maxSource = 'DB_MAX_POOL_SIZE';
  }

  let maxIdleTimeMS = 30000;
  let idleSource = 'default';
  if (env.MONGO_MAX_IDLE_TIME_MS !== undefined && env.MONGO_MAX_IDLE_TIME_MS !== '') {
    maxIdleTimeMS = parseInt(env.MONGO_MAX_IDLE_TIME_MS, 10);
    idleSource = 'MONGO_MAX_IDLE_TIME_MS';
  } else if (env.DB_MAX_IDLE_TIME_MS !== undefined && env.DB_MAX_IDLE_TIME_MS !== '') {
    maxIdleTimeMS = parseInt(env.DB_MAX_IDLE_TIME_MS, 10);
    idleSource = 'DB_MAX_IDLE_TIME_MS';
  }

  const sources = {
    minPoolSize: minSource,
    maxPoolSize: maxSource,
    maxIdleTimeMS: idleSource,
  };

  // Fail-fast sanity validations (NFR-40)
  if (isNaN(minPoolSize) || minPoolSize < 0) {
    throw new Error(
      `Fatal MongoDB Configuration Error: Invalid minPoolSize "${minPoolSize}" (source: ${minSource}). Must be a non-negative integer.`
    );
  }

  if (isNaN(maxPoolSize) || maxPoolSize < 1) {
    throw new Error(
      `Fatal MongoDB Configuration Error: Invalid maxPoolSize "${maxPoolSize}" (source: ${maxSource}). Must be an integer >= 1.`
    );
  }

  if (minPoolSize > maxPoolSize) {
    throw new Error(
      `Fatal MongoDB Configuration Error: minPoolSize (${minPoolSize} from ${minSource}) cannot exceed maxPoolSize (${maxPoolSize} from ${maxSource}).`
    );
  }

  if (isNaN(maxIdleTimeMS) || maxIdleTimeMS < 0) {
    throw new Error(
      `Fatal MongoDB Configuration Error: Invalid maxIdleTimeMS "${maxIdleTimeMS}" (source: ${idleSource}). Must be a non-negative integer.`
    );
  }

  return {
    minPoolSize,
    maxPoolSize,
    maxIdleTimeMS,
    sources,
  };
}

/**
 * Connects Mongoose default singleton instance with connection pooling (NFR-40).
 * Ensures compatibility with NFR-38 graceful shutdown handler (mongoose.connection.close).
 */
const connectDB = async (overrideEnv = null) => {
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
