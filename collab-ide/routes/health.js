/**
 * @file routes/health.js
 * @module routes/health
 * @description Health Check Route (NFR-39, NFR-48).
 *
 * Implements NFR-39: Health Check Endpoint:
 * "The server must expose a GET /health endpoint that returns HTTP 200 with a JSON payload
 * containing: server uptime, memory usage, active room count, and active WebSocket connection count.
 * This endpoint must be unauthenticated and used by the process manager and any monitoring tool
 * to verify server health."
 *
 * Implements NFR-48: Modular Backend Architecture:
 * Provides an independently testable route module for infrastructure health checks.
 */

const express = require('express');
const { createHealthHandler } = require('../services/healthCheck');

/**
 * Creates an Express router configured for the /health endpoint.
 * Supports both GET and HEAD methods with zero authentication barrier.
 *
 * @function createHealthRouter
 * @param {Object} options
 * @param {() => boolean} options.getIsShuttingDown - Predicate returning shutdown state
 * @param {Object} options.roomManager - Collaborative room manager
 * @param {() => number} options.getMaxWsPerRoom - Resolver for max WS limit
 * @param {Object} [options.mongooseInstance] - Optional Mongoose instance
 * @returns {express.Router}
 */
function createHealthRouter(options = {}) {
  const router = express.Router();
  const handler = createHealthHandler(options);

  router.get('/', handler);
  router.head('/', handler);

  // Allow monitoring tools to inspect supported HTTP verbs
  router.options('/', (req, res) => {
    res.set({
      'Allow': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.sendStatus(204);
  });

  return router;
}

module.exports = {
  createHealthRouter,
};
