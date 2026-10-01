/**
 * @file test/test_nfr39_health_check.js
 * @description Comprehensive automated test suite for NFR-39: Health Check Endpoint.
 *
 * Implements verification for NFR-39:
 * "The server must expose a GET /health endpoint that returns HTTP 200 with a JSON payload
 * containing: server uptime, memory usage, active room count, and active WebSocket connection count.
 * This endpoint must be unauthenticated and used by the process manager and any monitoring tool
 * to verify server health."
 *
 * Test Phases:
 * 1. Modular Health Service Unit Tests (NFR-48 testability with mock dependencies)
 * 2. Live HTTP Endpoint GET /health (Unauthenticated HTTP 200 OK)
 * 3. Exact Required Payload Schema & Alias Verification (uptime, memoryUsage, activeRooms, activeWebSockets)
 * 4. Memory Usage Object Inspection (RSS, heapTotal, heapUsed, external, formatted MB strings)
 * 5. Dynamic Real-Time Active Room Tracking (Creation & Unloading reflection)
 * 6. Dynamic Real-Time Active WebSocket Connection Tracking (Connect & Disconnect reflection)
 * 7. Database Connection Pooling Observability & Security Sanitization (NFR-40)
 * 8. Graceful Shutdown 503 Service Unavailable Protocol (NFR-38)
 * 9. Unauthenticated Resilience Invariant (No tokens, invalid tokens, invalid cookies, no CSRF)
 * 10. HTTP HEAD & OPTIONS Method Support (Monitoring probe compatibility)
 * 11. Anti-Caching Headers Verification (no-cache, no-store, must-revalidate)
 * 12. Rate-Limiting Exemption Verification (30 rapid-fire burst requests pass without 429)
 * 13. Nginx Reverse Proxy Configuration & Dockerfile Healthcheck Alignment
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { getHealthMetrics, formatMB, formatUptime, createHealthHandler } = require('../services/healthCheck');
const { createHealthRouter } = require('../routes/health');
const roomManager = require('../services/roomManager');
const { app } = require('../server');

let passedTests = 0;
let failedTests = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-39: Health Check Endpoint Verification Tests');
  console.log('================================================================');

  let server;
  let baseUrl;

  try {
    // --------------------------------------------------------------------------
    // Phase 1: Modular Health Service Unit Tests (NFR-48)
    // --------------------------------------------------------------------------
    console.log('\n🧩 Phase 1: Modular Health Service Unit Tests (NFR-48)...');

    // Unit test: formatMB
    check(formatMB(1024 * 1024) === '1.00 MB', 'formatMB(1MB) returns "1.00 MB"');
    check(formatMB(50 * 1024 * 1024) === '50.00 MB', 'formatMB(50MB) returns "50.00 MB"');
    check(formatMB(-10) === '0.00 MB', 'formatMB negative value returns safe fallback "0.00 MB"');

    // Unit test: formatUptime
    check(formatUptime(45) === '45.00s', 'formatUptime(45) formats as seconds');
    check(formatUptime(125).includes('2m 5s'), 'formatUptime(125) formats minutes and seconds');
    check(formatUptime(3665).includes('1h 1m 5s'), 'formatUptime(3665) formats hours, minutes, seconds');

    // Unit test: getHealthMetrics with mock room manager and mock DB
    const mockRoomManager = {
      rooms: new Map([
        ['room-1', {}],
        ['room-2', {}],
      ]),
      getTotalActiveWebSockets: () => 7,
      getDiagnostics: () => [{ roomId: 'room-1', clientCount: 4 }, { roomId: 'room-2', clientCount: 3 }],
    };

    const mockMongoose = {
      connection: {
        readyState: 1,
        getClient: () => ({
          options: { minPoolSize: 5, maxPoolSize: 20, maxIdleTimeMS: 30000 },
        }),
      },
    };

    const unitMetrics = getHealthMetrics({
      roomManager: mockRoomManager,
      isShuttingDown: false,
      maxWsPerRoom: 25,
      mongooseInstance: mockMongoose,
    });

    check(unitMetrics.status === 'healthy', 'Unit metrics report status "healthy"');
    check(typeof unitMetrics.uptime === 'number' && unitMetrics.uptime >= 0, 'Unit metrics contain numeric uptime');
    check(unitMetrics.serverUptime === unitMetrics.uptime, 'Unit metrics alias serverUptime matches uptime');
    check(unitMetrics.activeRooms === 2, 'Unit metrics report activeRooms = 2');
    check(unitMetrics.activeRoomCount === 2, 'Unit metrics report activeRoomCount = 2');
    check(unitMetrics.activeWebSockets === 7, 'Unit metrics report activeWebSockets = 7');
    check(unitMetrics.activeWebSocketConnections === 7, 'Unit metrics report activeWebSocketConnections = 7');
    check(unitMetrics.maxWsPerRoom === 25, 'Unit metrics report maxWsPerRoom = 25');
    check(unitMetrics.database.connected === true, 'Unit metrics report database.connected = true');
    check(unitMetrics.database.minPoolSize === 5, 'Unit metrics report minPoolSize = 5');
    check(unitMetrics.database.maxPoolSize === 20, 'Unit metrics report maxPoolSize = 20');
    check(Array.isArray(unitMetrics.roomIsolation.rooms), 'Unit metrics contain roomIsolation.rooms array');

    // Unit test: graceful shutdown status
    const shutdownMetrics = getHealthMetrics({
      roomManager: mockRoomManager,
      isShuttingDown: true,
      mongooseInstance: mockMongoose,
    });
    check(shutdownMetrics.status === 'shutting_down', 'Unit metrics report status "shutting_down" when shutting down');

    // --------------------------------------------------------------------------
    // Start Live Test HTTP Server
    // --------------------------------------------------------------------------
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`\n🚀 Live Test Server listening at ${baseUrl}`);

    // --------------------------------------------------------------------------
    // Phase 2: Live HTTP Endpoint GET /health (Unauthenticated 200 OK)
    // --------------------------------------------------------------------------
    console.log('\n🏥 Phase 2: Live HTTP Endpoint GET /health...');
    const healthRes = await fetch(`${baseUrl}/health`);
    check(healthRes.status === 200, 'GET /health returns HTTP 200 OK');
    check(healthRes.headers.get('content-type')?.includes('application/json'), 'Content-Type header is application/json');

    const healthData = await healthRes.json();
    check(healthData && typeof healthData === 'object', 'GET /health response body is a valid JSON object');
    check(healthData.status === 'healthy', 'Health check reports status "healthy"');

    // --------------------------------------------------------------------------
    // Phase 3: Exact Required Payload Schema & Alias Verification
    // --------------------------------------------------------------------------
    console.log('\n📋 Phase 3: Exact Required Schema & Field Invariants (NFR-39)...');

    // 1. Server Uptime
    check(typeof healthData.uptime === 'number' && Number.isFinite(healthData.uptime), 'Payload contains finite numeric "uptime"');
    check(healthData.uptime >= 0, `Uptime is non-negative (${healthData.uptime.toFixed(2)}s)`);
    check(typeof healthData.serverUptime === 'number', 'Payload contains "serverUptime" alias');
    check(healthData.serverUptime === healthData.uptime, 'serverUptime matches uptime');
    check(typeof healthData.formattedUptime === 'string', 'Payload contains formatted human-readable uptime');

    // 2. Memory Usage
    check(healthData.memoryUsage && typeof healthData.memoryUsage === 'object', 'Payload contains "memoryUsage" object');
    check(typeof healthData.memoryUsage.rss === 'number' && healthData.memoryUsage.rss > 0, 'memoryUsage.rss is positive number');
    check(typeof healthData.memoryUsage.heapTotal === 'number' && healthData.memoryUsage.heapTotal > 0, 'memoryUsage.heapTotal is positive number');
    check(typeof healthData.memoryUsage.heapUsed === 'number' && healthData.memoryUsage.heapUsed > 0, 'memoryUsage.heapUsed is positive number');
    check(typeof healthData.memoryUsage.external === 'number', 'memoryUsage.external is number');
    check(healthData.memoryUsage.formatted && typeof healthData.memoryUsage.formatted === 'object', 'memoryUsage contains "formatted" human-readable strings');
    check(healthData.memoryUsage.formatted.rss.endsWith(' MB'), `memoryUsage.formatted.rss has MB units (${healthData.memoryUsage.formatted.rss})`);
    check(healthData.memoryUsage.formatted.heapUsed.endsWith(' MB'), `memoryUsage.formatted.heapUsed has MB units (${healthData.memoryUsage.formatted.heapUsed})`);

    // 3. Active Room Count
    check(typeof healthData.activeRooms === 'number', 'Payload contains numeric "activeRooms"');
    check(typeof healthData.activeRoomCount === 'number', 'Payload contains "activeRoomCount" alias');
    check(healthData.activeRoomCount === healthData.activeRooms, 'activeRoomCount matches activeRooms');

    // 4. Active WebSocket Connection Count
    check(typeof healthData.activeWebSockets === 'number', 'Payload contains numeric "activeWebSockets"');
    check(typeof healthData.activeWebSocketConnections === 'number', 'Payload contains "activeWebSocketConnections" alias');
    check(typeof healthData.activeWebSocketConnectionCount === 'number', 'Payload contains "activeWebSocketConnectionCount" alias');
    check(healthData.activeWebSocketConnections === healthData.activeWebSockets, 'activeWebSocketConnections matches activeWebSockets');

    // 5. System metadata
    check(typeof healthData.system === 'object', 'Payload contains "system" diagnostics');
    check(typeof healthData.system.pid === 'number', `System reports process PID (${healthData.system.pid})`);
    check(healthData.system.nodeVersion === process.version, `System reports matching Node.js version (${healthData.system.nodeVersion})`);

    // --------------------------------------------------------------------------
    // Phase 4: Dynamic Real-Time Active Room Tracking (NFR-39, NFR-52)
    // --------------------------------------------------------------------------
    console.log('\n🏠 Phase 4: Dynamic Real-Time Active Room Tracking...');
    const testRoomUuid1 = 'test-room-nfr39-alpha';
    const testRoomUuid2 = 'test-room-nfr39-beta';

    // Clear any previous test rooms
    await roomManager.unloadRoom(testRoomUuid1);
    await roomManager.unloadRoom(testRoomUuid2);

    const initialRoomCount = roomManager.rooms.size;
    const initialRes = await fetch(`${baseUrl}/health`);
    const initialData = await initialRes.json();
    check(initialData.activeRooms === initialRoomCount, `Initial health check reflects ${initialRoomCount} active rooms`);

    // Create 2 test rooms
    await roomManager.getOrCreateRoom(testRoomUuid1);
    await roomManager.getOrCreateRoom(testRoomUuid2);

    const afterCreateRes = await fetch(`${baseUrl}/health`);
    const afterCreateData = await afterCreateRes.json();
    check(afterCreateData.activeRooms === initialRoomCount + 2, `Health check updates in real-time to ${initialRoomCount + 2} active rooms`);
    check(afterCreateData.activeRoomCount === initialRoomCount + 2, 'activeRoomCount alias updates in real-time');

    // Unload 1 test room
    await roomManager.unloadRoom(testRoomUuid1);
    const afterUnloadRes = await fetch(`${baseUrl}/health`);
    const afterUnloadData = await afterUnloadRes.json();
    check(afterUnloadData.activeRooms === initialRoomCount + 1, `Health check drops to ${initialRoomCount + 1} active rooms after unload`);

    // Clean up second test room
    await roomManager.unloadRoom(testRoomUuid2);
    const finalRoomRes = await fetch(`${baseUrl}/health`);
    const finalRoomData = await finalRoomRes.json();
    check(finalRoomData.activeRooms === initialRoomCount, `Health check returns to baseline ${initialRoomCount} active rooms`);

    // --------------------------------------------------------------------------
    // Phase 5: Dynamic Real-Time Active WebSocket Connection Tracking (NFR-36, NFR-39)
    // --------------------------------------------------------------------------
    console.log('\n🔌 Phase 5: Dynamic Real-Time Active WebSocket Connection Tracking...');
    const wsRoomUuid = 'test-room-nfr39-ws';
    const roomSession = await roomManager.getOrCreateRoom(wsRoomUuid);

    const initialWsRes = await fetch(`${baseUrl}/health`);
    const initialWsData = await initialWsRes.json();
    const initialWsCount = initialWsData.activeWebSockets;

    // Simulate 3 mock WebSocket connections in roomSession
    const mockSockets = [
      { readyState: 1, send: () => {}, close: () => {} }, // OPEN = 1
      { readyState: 1, send: () => {}, close: () => {} },
      { readyState: 1, send: () => {}, close: () => {} },
    ];
    mockSockets.forEach((ws, idx) => {
      roomSession.addClient(ws, { _id: `user-${idx}`, displayName: `User ${idx}` }, 'Editor');
    });

    const activeWsRes = await fetch(`${baseUrl}/health`);
    const activeWsData = await activeWsRes.json();
    check(activeWsData.activeWebSockets === initialWsCount + 3, `Health check reports 3 new active WebSockets (${activeWsData.activeWebSockets})`);
    check(activeWsData.activeWebSocketConnections === initialWsCount + 3, 'activeWebSocketConnections alias tracks 3 active sockets');

    // Simulate disconnecting 2 mock sockets
    roomSession.removeClient(mockSockets[0]);
    roomSession.removeClient(mockSockets[1]);

    const partialWsRes = await fetch(`${baseUrl}/health`);
    const partialWsData = await partialWsRes.json();
    check(partialWsData.activeWebSockets === initialWsCount + 1, `Health check drops to 1 active socket after disconnections (${partialWsData.activeWebSockets})`);

    // Clean up remaining mock socket and unload room
    roomSession.removeClient(mockSockets[2]);
    await roomManager.unloadRoom(wsRoomUuid);

    const cleanWsRes = await fetch(`${baseUrl}/health`);
    const cleanWsData = await cleanWsRes.json();
    check(cleanWsData.activeWebSockets === initialWsCount, `Health check returns to baseline WebSocket count (${initialWsCount})`);

    // --------------------------------------------------------------------------
    // Phase 6: Database Connection Pooling & Security Sanitization (NFR-40, NFR-23)
    // --------------------------------------------------------------------------
    console.log('\n🔒 Phase 6: Database Connection Pooling & Security Sanitization...');
    check(healthData.database && typeof healthData.database === 'object', 'Payload contains "database" configuration object');
    check(typeof healthData.database.connected === 'boolean', `database.connected is boolean (${healthData.database.connected})`);
    check(healthData.database.minPoolSize === 5, `database.minPoolSize reports 5 (Actual: ${healthData.database.minPoolSize})`);
    check(healthData.database.maxPoolSize === 20, `database.maxPoolSize reports 20 (Actual: ${healthData.database.maxPoolSize})`);
    check(healthData.database.maxIdleTimeMS === 30000, `database.maxIdleTimeMS reports 30000 (Actual: ${healthData.database.maxIdleTimeMS})`);

    const rawHealthJson = JSON.stringify(healthData);
    check(!rawHealthJson.includes('mongodb://'), 'Health check payload does NOT leak MongoDB connection URI');
    check(!rawHealthJson.includes('authSource'), 'Health check payload does NOT leak database auth credentials');
    check(!rawHealthJson.includes('password'), 'Health check payload does NOT contain any passwords');

    // --------------------------------------------------------------------------
    // Phase 7: Graceful Shutdown 503 Protocol (NFR-38)
    // --------------------------------------------------------------------------
    console.log('\n🛑 Phase 7: Graceful Shutdown 503 Service Unavailable Protocol (NFR-38)...');
    let testShuttingDown = true;
    const shutdownHandler = createHealthHandler({
      getIsShuttingDown: () => testShuttingDown,
      roomManager,
      getMaxWsPerRoom: () => 20,
    });

    const shutdownApp = express();
    shutdownApp.get('/health', shutdownHandler);
    const shutdownServer = http.createServer(shutdownApp);
    await new Promise((resolve) => shutdownServer.listen(0, '127.0.0.1', resolve));
    const shutdownPort = shutdownServer.address().port;

    try {
      const shutdownRes = await fetch(`http://127.0.0.1:${shutdownPort}/health`);
      check(shutdownRes.status === 503, 'GET /health returns HTTP 503 during graceful shutdown');
      const shutdownData = await shutdownRes.json();
      check(shutdownData.status === 'shutting_down', 'status field is "shutting_down"');
      check(typeof shutdownData.uptime === 'number', 'Full metrics still included during shutdown for diagnosis');
    } finally {
      shutdownServer.close();
    }

    // --------------------------------------------------------------------------
    // Phase 8: Unauthenticated Resilience Invariant
    // --------------------------------------------------------------------------
    console.log('\n🔓 Phase 8: Unauthenticated Resilience Invariant...');

    // Request with NO headers at all
    const bareRes = await fetch(`${baseUrl}/health`);
    check(bareRes.status === 200, 'GET /health succeeds with zero authentication headers');

    // Request with arbitrary/invalid Authorization Bearer token
    const invalidAuthRes = await fetch(`${baseUrl}/health`, {
      headers: {
        Authorization: 'Bearer invalid.bogus.jwt.token.here',
      },
    });
    check(invalidAuthRes.status === 200, 'GET /health succeeds even with bogus Authorization Bearer token (no 401/403 rejection)');

    // Request with random cookie headers
    const cookieRes = await fetch(`${baseUrl}/health`, {
      headers: {
        Cookie: 'session=corrupted; malicious=1; refreshToken=expired',
      },
    });
    check(cookieRes.status === 200, 'GET /health succeeds with arbitrary cookies');

    // Request without CSRF token
    const noCsrfRes = await fetch(`${baseUrl}/health`, {
      headers: {
        'User-Agent': 'Prometheus/2.45.0 UptimeMonitoringAgent',
      },
    });
    check(noCsrfRes.status === 200, 'GET /health succeeds without CSRF tokens from monitoring User-Agents');

    // --------------------------------------------------------------------------
    // Phase 9: HTTP HEAD & OPTIONS Method Support
    // --------------------------------------------------------------------------
    console.log('\n🔍 Phase 9: HTTP HEAD & OPTIONS Method Support (Monitoring Probes)...');

    // HEAD request
    const headRes = await fetch(`${baseUrl}/health`, { method: 'HEAD' });
    check(headRes.status === 200, 'HEAD /health returns HTTP 200 OK');
    const headBody = await headRes.text();
    check(headBody.length === 0, 'HEAD /health body is empty (zero bandwidth probe)');
    check(headRes.headers.get('content-type')?.includes('application/json'), 'HEAD /health reports application/json content-type');

    // OPTIONS request
    const optionsRes = await fetch(`${baseUrl}/health`, { method: 'OPTIONS' });
    check(optionsRes.status === 200 || optionsRes.status === 204, `OPTIONS /health returns HTTP ${optionsRes.status}`);

    // --------------------------------------------------------------------------
    // Phase 10: Anti-Caching Headers Verification
    // --------------------------------------------------------------------------
    console.log('\n🚫 Phase 10: Anti-Caching Headers Verification...');
    const cacheControl = healthRes.headers.get('cache-control');
    check(cacheControl !== null, 'Response includes Cache-Control header');
    check(cacheControl?.includes('no-cache'), 'Cache-Control includes "no-cache"');
    check(cacheControl?.includes('no-store'), 'Cache-Control includes "no-store"');
    check(healthRes.headers.get('pragma') === 'no-cache', 'Response includes Pragma: no-cache');
    check(healthRes.headers.get('expires') === '0', 'Response includes Expires: 0');

    // --------------------------------------------------------------------------
    // Phase 11: Rate-Limiting Exemption Verification
    // --------------------------------------------------------------------------
    console.log('\n⚡ Phase 11: Rate-Limiting Exemption Verification...');
    const burstCount = 30;
    const burstPromises = [];
    for (let i = 0; i < burstCount; i++) {
      burstPromises.push(fetch(`${baseUrl}/health`));
    }
    const burstResponses = await Promise.all(burstPromises);
    const all200 = burstResponses.every((r) => r.status === 200);
    const any429 = burstResponses.some((r) => r.status === 429);
    check(all200, `Burst of ${burstCount} concurrent health checks all returned HTTP 200 OK`);
    check(!any429, `No requests in burst received HTTP 429 Too Many Requests`);

    // --------------------------------------------------------------------------
    // Phase 12: Reverse Proxy Configuration Alignment (Nginx & Dockerfile)
    // --------------------------------------------------------------------------
    console.log('\n🌐 Phase 12: Reverse Proxy Configuration Alignment (Nginx & Docker)...');
    const nginxConfPath = path.resolve(__dirname, '../../nginx/conf.d/collabide.conf');
    const nginxTmplPath = path.resolve(__dirname, '../../nginx/templates/collabide.conf.template');
    const dockerfilePath = path.resolve(__dirname, '../../nginx/Dockerfile');

    check(fs.existsSync(nginxConfPath), 'nginx/conf.d/collabide.conf exists');
    check(fs.existsSync(nginxTmplPath), 'nginx/templates/collabide.conf.template exists');
    check(fs.existsSync(dockerfilePath), 'nginx/Dockerfile exists');

    if (fs.existsSync(nginxConfPath)) {
      const confContent = fs.readFileSync(nginxConfPath, 'utf8');
      check(confContent.includes('location /health'), 'collabide.conf contains location /health block');
      check(confContent.includes('proxy_pass http://nodejs_backend/health'), 'collabide.conf routes /health to nodejs_backend/health');
      const healthBlockMatch = confContent.match(/location\s+\/health\s*\{([^}]+)\}/);
      const healthBlock = healthBlockMatch ? healthBlockMatch[1] : '';
      check(healthBlock.length > 0, 'collabide.conf has non-empty location /health block');
      check(!healthBlock.includes('limit_req'), '/health block in collabide.conf is unthrottled (no limit_req directive)');
    }

    if (fs.existsSync(nginxTmplPath)) {
      const tmplContent = fs.readFileSync(nginxTmplPath, 'utf8');
      check(tmplContent.includes('location /health'), 'collabide.conf.template contains location /health block');
      check(tmplContent.includes('proxy_pass http://nodejs_backend/health'), 'collabide.conf.template routes /health to nodejs_backend/health');
      const tmplHealthMatch = tmplContent.match(/location\s+\/health\s*\{([^}]+)\}/);
      const tmplHealthBlock = tmplHealthMatch ? tmplHealthMatch[1] : '';
      check(!tmplHealthBlock.includes('limit_req'), '/health block in collabide.conf.template is unthrottled (no limit_req directive)');
    }

    if (fs.existsSync(dockerfilePath)) {
      const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
      check(dockerContent.includes('/health'), 'nginx/Dockerfile uses /health endpoint for container HEALTHCHECK');
    }

  } catch (err) {
    console.error(`\n💥 Unexpected test suite exception: ${err.message}`);
    console.error(err.stack);
    failedTests++;
  } finally {
    if (server) {
      server.close();
    }
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ NFR-39 Health Check verification FAILED.');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-39 HEALTH CHECK ENDPOINT REQUIREMENTS SATISFIED!');
    process.exit(0);
  }
}

runTests();
