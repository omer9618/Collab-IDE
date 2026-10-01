/**
 * @file services/healthCheck.js
 * @module services/healthCheck
 * @description System health metrics collector and operational observability service (NFR-39, NFR-48).
 *
 * Implements NFR-39: Health Check Endpoint:
 * "The server must expose a GET /health endpoint that returns HTTP 200 with a JSON payload
 * containing: server uptime, memory usage, active room count, and active WebSocket connection count.
 * This endpoint must be unauthenticated and used by the process manager and any monitoring tool
 * to verify server health."
 *
 * Implements NFR-48: Modular Backend Architecture:
 * "The backend must be structured as independent modules: auth, rooms, websocket-relay,
 * execution, voice-signalling, and infrastructure (rate limiting, health checks).
 * Each module must be independently testable."
 */

const defaultMongoose = require('mongoose');

/**
 * Formats a byte quantity into a human-readable megabyte string.
 *
 * @function formatMB
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted megabytes string (e.g., "42.15 MB")
 */
function formatMB(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return '0.00 MB';
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Formats seconds into a human-readable duration string.
 *
 * @function formatUptime
 * @param {number} seconds - Number of seconds
 * @returns {string} Formatted uptime string (e.g., "1h 15m 32s" or "45.20s")
 */
function formatUptime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '0.00s';
  }
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${seconds.toFixed(2)}s`;
}

/**
 * Collects live operational metrics across server subsystems.
 * Pure and independently testable with mock providers (NFR-48).
 *
 * @function getHealthMetrics
 * @param {Object} [options={}]
 * @param {Object} [options.roomManager] - Collaborative room manager instance
 * @param {boolean} [options.isShuttingDown=false] - Whether server is terminating (NFR-38)
 * @param {number} [options.maxWsPerRoom=20] - Maximum WebSockets per room capacity (NFR-36)
 * @param {Object} [options.mongooseInstance] - Mongoose database instance or mock
 * @returns {Object} Structured health check payload
 */
function getHealthMetrics(options = {}) {
  const {
    roomManager,
    isShuttingDown = false,
    maxWsPerRoom = 20,
    mongooseInstance = defaultMongoose,
  } = options;

  const uptime = process.uptime();
  const mem = process.memoryUsage();

  // Active rooms in memory (NFR-39, NFR-52)
  const activeRooms = roomManager?.rooms?.size ?? 0;

  // Active WebSocket connections across all rooms (NFR-36, NFR-39)
  const activeWebSockets = typeof roomManager?.getTotalActiveWebSockets === 'function'
    ? roomManager.getTotalActiveWebSockets()
    : 0;

  // Room isolation diagnostics array (NFR-52)
  const roomIsolationDiagnostics = typeof roomManager?.getDiagnostics === 'function'
    ? roomManager.getDiagnostics()
    : [];

  // Database connection pooling & readiness inspection (NFR-40)
  const conn = mongooseInstance?.connection;
  const client = conn?.getClient && typeof conn.getClient === 'function' ? conn.getClient() : null;
  const isDbConnected = conn?.readyState === 1;
  const resolvedMinPool = (typeof client?.options?.minPoolSize === 'number')
    ? client.options.minPoolSize
    : (parseInt(process.env.MONGO_MIN_POOL_SIZE || process.env.DB_MIN_POOL_SIZE || '5', 10) || 5);
  const resolvedMaxPool = (typeof client?.options?.maxPoolSize === 'number')
    ? client.options.maxPoolSize
    : (parseInt(process.env.MONGO_MAX_POOL_SIZE || process.env.DB_MAX_POOL_SIZE || '20', 10) || 20);
  const resolvedIdleTimeout = (typeof client?.options?.maxIdleTimeMS === 'number' && client.options.maxIdleTimeMS > 0)
    ? client.options.maxIdleTimeMS
    : (parseInt(process.env.MONGO_MAX_IDLE_TIME_MS || process.env.DB_MAX_IDLE_TIME_MS || '30000', 10) || 30000);

  // Status computation: 'shutting_down' during SIGTERM/SIGINT, 'healthy' during normal ops
  const status = isShuttingDown ? 'shutting_down' : 'healthy';

  return {
    status,
    timestamp: new Date().toISOString(),
    // Core NFR-39 requirements & descriptive aliases
    uptime,
    serverUptime: uptime,
    formattedUptime: formatUptime(uptime),
    memoryUsage: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      formatted: {
        rss: formatMB(mem.rss),
        heapTotal: formatMB(mem.heapTotal),
        heapUsed: formatMB(mem.heapUsed),
        external: formatMB(mem.external),
      },
    },
    activeRooms,
    activeRoomCount: activeRooms,
    activeWebSockets,
    activeWebSocketConnections: activeWebSockets,
    activeWebSocketConnectionCount: activeWebSockets,
    // Observability across related NFRs
    maxWsPerRoom,
    roomIsolation: {
      rooms: roomIsolationDiagnostics,
    },
    database: {
      connected: isDbConnected,
      minPoolSize: resolvedMinPool,
      maxPoolSize: resolvedMaxPool,
      maxIdleTimeMS: resolvedIdleTimeout,
    },
    system: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      env: process.env.NODE_ENV || 'development',
    },
  };
}

/**
 * Creates an Express request handler for GET and HEAD /health.
 *
 * Invariants:
 * 1. Returns HTTP 200 with JSON payload during normal operation.
 * 2. Returns HTTP 503 during graceful shutdown (NFR-38).
 * 3. Sets no-cache headers to prevent proxy/browser caching of real-time metrics.
 * 4. Completely unauthenticated and unthrottled for automated monitors.
 *
 * @function createHealthHandler
 * @param {Object} dependencies
 * @param {() => boolean} dependencies.getIsShuttingDown - Predicate returning shutdown state
 * @param {Object} dependencies.roomManager - Collaborative room manager
 * @param {() => number} dependencies.getMaxWsPerRoom - Resolver for max WS limit
 * @param {Object} [dependencies.mongooseInstance] - Optional Mongoose instance
 * @returns {import('express').RequestHandler}
 */
function createHealthHandler(dependencies = {}) {
  const {
    getIsShuttingDown,
    roomManager,
    getMaxWsPerRoom,
    mongooseInstance = defaultMongoose,
  } = dependencies;

  return (req, res) => {
    const isShuttingDown = Boolean(getIsShuttingDown && getIsShuttingDown());
    const maxWsLimit = typeof getMaxWsPerRoom === 'function' ? getMaxWsPerRoom() : 20;

    const metrics = getHealthMetrics({
      roomManager,
      isShuttingDown,
      maxWsPerRoom: maxWsLimit,
      mongooseInstance,
    });

    // Operational monitoring invariants: prevent intermediate proxy and browser caching
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });

    if (isShuttingDown) {
      return res.status(503).json(metrics);
    }

    return res.status(200).json(metrics);
  };
}

module.exports = {
  formatMB,
  formatUptime,
  getHealthMetrics,
  createHealthHandler,
};
