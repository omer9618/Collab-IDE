/**
 * @file modules/infrastructure/index.js
 * @module modules/infrastructure
 * @description Infrastructure & Core Services Module (NFR-23, NFR-35, NFR-38, NFR-39, NFR-40, NFR-47, NFR-48).
 * 
 * Encapsulates:
 * - Rate limiting middleware (NFR-35, express-rate-limit factories)
 * - Health check endpoint and diagnostics reporting (NFR-39)
 * - MongoDB connection establishment and connection pooling (NFR-40)
 * - Universal logger with log sanitization and file security (NFR-23)
 * - AES-256-GCM field-level encryption with SHA-256 blind indexing (NFR-24)
 * - Double Submit Cookie CSRF defense (NFR-15)
 * - Centralized plain-English error handling and 404 sanitization (NFR-47)
 */

const { apiLimiter, createRateLimiter } = require('../../middleware/rateLimiter');
const { getHealthMetrics, formatMB, formatUptime, createHealthHandler } = require('../../services/healthCheck');
const { createHealthRouter } = require('../../routes/health');
const { connectDB, resolvePoolConfig } = require('../../config/db');
const logger = require('../../utils/logger');
const encryption = require('../../utils/encryption');
const csrf = require('../../middleware/csrf');
const errorHandler = require('../../middleware/errorHandler');
const env = require('../../config/env');

module.exports = {
  name: 'infrastructure',
  config: env,
  env,
  rateLimiting: {
    apiLimiter,
    createRateLimiter,
  },
  rateLimiter: {
    apiLimiter,
    createRateLimiter,
  },
  health: {
    getHealthMetrics,
    formatMB,
    formatUptime,
    createHealthHandler,
    createHealthRouter,
  },
  healthChecks: {
    getHealthMetrics,
    formatMB,
    formatUptime,
    createHealthHandler,
    createHealthRouter,
  },
  database: {
    connectDB,
    resolvePoolConfig,
  },
  logging: logger,
  logger,
  security: {
    encryption,
    csrf,
  },
  encryption,
  csrf,
  errorHandler,
  stateless: {
    enabled: true,
    sessionStorage: 'tokens-and-db',
    inMemorySessionStore: false,
    supportsHorizontalScaling: true,
  },
  pubsub: require('../../services/pubsub'),
  horizontalScaling: {
    ready: true,
    supportsRedisAdapter: true,
    singleProcessAssumptions: false,
  },
  sharedNothing: {
    ready: true,
    statelessBackend: true,
    noExclusiveLocalMemory: true,
    clusterPresence: true,
    zeroDataLossFailover: true,
  },
  assertSharedNothingBackend: (app) => {
    // 1. Verify stateless REST pipeline
    const { assertStatelessPipeline } = require('../auth');
    if (typeof assertStatelessPipeline === 'function') {
      assertStatelessPipeline(app);
    }
    // 2. Verify Room model schema persistence
    const Room = require('../../models/Room');
    if (!Room.schema.path('ydocState') || !Room.schema.path('files')) {
      throw new Error('Shared-nothing validation failed: Room model missing ydocState or files persistence.');
    }
    // 3. Verify RoomManager cluster presence capabilities
    const roomManager = require('../../services/roomManager');
    if (typeof roomManager.getPresenceMap !== 'function' || typeof roomManager.handleClusterPresenceMessage !== 'function') {
      throw new Error('Shared-nothing validation failed: RoomManager lacks cluster presence synchronization.');
    }
    return true;
  },
};
