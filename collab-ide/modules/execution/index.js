/**
 * @file modules/execution/index.js
 * @module modules/execution
 * @description Remote Code Execution Module (FR-27 – FR-35, NFR-35, NFR-43, NFR-48).
 * 
 * Encapsulates:
 * - Multi-language compilation and execution runtimes (JavaScript, Python, C++, C, Java, HTML)
 * - Remote Judge0 CE sandbox dispatching and Base64 stream encoding
 * - Container resource ceilings (CPU 10s, Wall 12s, RAM 128MB, stdout/stderr 64KB) (NFR-43)
 * - Role-Based execution permissions (preventing Viewer abuse) (FR-27)
 * - User-scoped execution rate limiting (10 runs/min/user) (NFR-35)
 * - Offline mock execution engine for local development and CI testing
 */

const executionRoutes = require('../../routes/execution');

/**
 * Checks if a language key is supported by the execution engine.
 *
 * @function isLanguageSupported
 * @param {string} languageKey - Identifier (e.g. 'javascript', 'python')
 * @returns {boolean}
 */
function isLanguageSupported(languageKey) {
  return Boolean(executionRoutes.LANGUAGE_MAP && executionRoutes.LANGUAGE_MAP[languageKey]);
}

/**
 * Returns configuration metadata for a supported language.
 *
 * @function getLanguageConfig
 * @param {string} languageKey - Identifier
 * @returns {{ id: number|null, name: string }|null}
 */
function getLanguageConfig(languageKey) {
  return executionRoutes.LANGUAGE_MAP ? executionRoutes.LANGUAGE_MAP[languageKey] || null : null;
}

/**
 * Checks whether a collaborative room role has permission to execute code (FR-27).
 * Viewers are prohibited from executing code to prevent quota exhaustion and CPU abuse.
 *
 * @function canRoleExecute
 * @param {string} role - User's collaborative role in room
 * @returns {boolean} True if allowed, false if rejected
 */
function canRoleExecute(role) {
  return role === 'Owner' || role === 'Room Leader' || role === 'Editor';
}

module.exports = {
  name: 'execution',
  routes: executionRoutes,
  router: executionRoutes,
  LANGUAGE_MAP: executionRoutes.LANGUAGE_MAP,
  JUDGE0_LIMITS: executionRoutes.JUDGE0_LIMITS,
  MAX_EXEC_HISTORY: executionRoutes.MAX_EXEC_HISTORY || 20,
  execLimiter: executionRoutes.execLimiter,
  getMockResult: executionRoutes.getMockResult,
  submitToJudge0: executionRoutes.submitToJudge0,
  isLanguageSupported,
  getLanguageConfig,
  canRoleExecute,
};
