/**
 * @file modules/index.js
 * @module modules
 * @description Central Module Registry & Manifest for CollabIDE (NFR-48).
 * 
 * Enforces the Modular Backend Architecture requirement:
 * "The backend must be structured as independent modules: auth, rooms, websocket-relay,
 * execution, voice-signalling, and infrastructure (rate limiting, health checks). Each module
 * must be independently testable."
 * 
 * Modules:
 * 1. auth: Identity, credentials, RS256 JWT, refresh rotation, CSRF, lockout, policy
 * 2. rooms: Collaborative workspaces, RBAC, document management, lifecycle, isolation
 * 3. websocket-relay: Yjs CRDT synchronization, WebSocket server attachment, client sets, limits
 * 4. execution: Judge0 remote execution sandbox, language runtimes, container resource limits
 * 5. voice-signalling: WebRTC mesh signaling gateway, ICE credential generation
 * 6. infrastructure: Rate limiting, health checks, database pooling, logging, encryption
 */

const auth = require('./auth');
const rooms = require('./rooms');
const websocketRelay = require('./websocket-relay');
const execution = require('./execution');
const voiceSignalling = require('./voice-signalling');
const infrastructure = require('./infrastructure');

const MODULE_NAMES = [
  'auth',
  'rooms',
  'websocket-relay',
  'execution',
  'voice-signalling',
  'infrastructure',
];

const moduleRegistry = {
  auth,
  rooms,
  'websocket-relay': websocketRelay,
  'websocketrelay': websocketRelay,
  websocketRelay,
  execution,
  'voice-signalling': voiceSignalling,
  'voicesignalling': voiceSignalling,
  voiceSignalling,
  infrastructure,
};

/**
 * Retrieves an independent backend module by its canonical, camelCase, or normalized name.
 *
 * @function getModule
 * @param {string} name - Module name ('auth' | 'rooms' | 'websocket-relay' | 'execution' | 'voice-signalling' | 'infrastructure')
 * @returns {object|null} The resolved module or null if not found
 */
function getModule(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const normalizedNoHyphen = lower.replace(/[-_]/g, '');
  return (
    moduleRegistry[trimmed] ||
    moduleRegistry[lower] ||
    moduleRegistry[normalizedNoHyphen] ||
    null
  );
}

/**
 * Returns the list of canonical module names.
 *
 * @function getModuleNames
 * @returns {string[]}
 */
function getModuleNames() {
  return [...MODULE_NAMES];
}

module.exports = {
  auth,
  rooms,
  'websocket-relay': websocketRelay,
  websocketRelay,
  execution,
  'voice-signalling': voiceSignalling,
  voiceSignalling,
  infrastructure,
  MODULE_NAMES,
  getModule,
  getModuleNames,
};
