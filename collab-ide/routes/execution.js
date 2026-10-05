/**
 * @file routes/execution.js
 * @module routes/execution
 * @description Code Execution Module (FR-27 – FR-33, NFR-35, NFR-43, NFR-48).
 * 
 * Proxies compilation and execution requests to the remote Judge0 CE sandbox API.
 * Broadcasts execution results live across room WebSocket connections and persists
 * the last 20 outcomes in MongoDB.
 * 
 * SECURITY REASONING & ROLE ENFORCEMENT:
 * - Viewer Role Execution Guard (FR-27): Only Editors and Owners may trigger code execution.
 *   Viewers are strictly halted with HTTP 403 Forbidden to prevent compute resource abuse,
 *   unauthorized quota consumption, and denial-of-service against the room's rate limits.
 * - Resource Caps (NFR-43): Enforces strict CPU, wall time, memory, and output size caps
 *   on every submission to neutralize infinite loops, fork bombs, and memory exhaustion.
 * - Strict Rate Limiting (NFR-35): Capped at 10 runs per minute per user.
 * - Room Isolation (NFR-52): Submissions and execution broadcasts are scoped strictly to
 *   the room where the code was executed.
 */

const express  = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { sendPlainEnglishError } = require('../middleware/errorHandler');
const Room = require('../models/Room');
const logger = require('../utils/logger');

const router = express.Router({ mergeParams: true });

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Judge0 Language ID Map (FR-23, FR-28).
 * Maps internal language keys to their official Judge0 CE runtime IDs and descriptions.
 * HTML/CSS uses id: null because it executes client-side in a sandboxed browser iframe (FR-33).
 * 
 * @constant
 * @type {Record<string, { id: number|null, name: string }>}
 */
const LANGUAGE_MAP = {
  javascript: { id: 63, name: 'JavaScript (Node.js 12.14.0)' },
  python:     { id: 71, name: 'Python (3.8.1)' },
  cpp:        { id: 54, name: 'C++ (GCC 9.2.0)' },
  c:          { id: 50, name: 'C (GCC 9.2.0)' },
  java:       { id: 62, name: 'Java (OpenJDK 13.0.1)' },
  html:       { id: null, name: 'HTML/CSS (Web Browser)' },
};

/**
 * Hard resource limits applied on every Judge0 submission (NFR-43).
 * Neutralizes denial-of-service attacks, infinite loops, and memory bloat.
 * 
 * @constant
 * @type {{ cpu_time_limit: number, wall_time_limit: number, memory_limit: number, max_file_size: number }}
 */
const JUDGE0_LIMITS = {
  cpu_time_limit:       10.0,    // Max 10 CPU seconds per run
  wall_time_limit:      12.0,    // Max 12 wall-clock seconds before timeout kill
  memory_limit:         131072,  // Max 128 MB RAM allocation (128 * 1024)
  max_file_size:        64,      // Max 64 KB stdout/stderr buffer to prevent memory exhaustion
};

/**
 * Maximum persisted execution results per room (NFR-37).
 * Capped to preserve MongoDB document size limits.
 * 
 * @constant
 * @type {number}
 */
const MAX_EXEC_HISTORY = 20;

// ─── Rate Limiter (NFR-35: 10 req/min/user) ───────────────────────────────────

/**
 * Code Execution Rate Limiter — 10 runs per minute per user (NFR-35).
 * 
 * SECURITY REASONING:
 * Keyed strictly per authenticated user (`req.user.userId`). This prevents malicious
 * scripts from exhausting Judge0 API monthly quotas or tying up server thread pools.
 * 
 * @type {import('express').RequestHandler}
 */
const execLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user.userId, // per-user, not per-IP
  message: { message: 'You have reached the maximum limit of 10 code runs per minute. Please wait a moment before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || process.env.NODE_ENV === 'test';
  },
});

// ─── Judge0 Submission (real mode) ────────────────────────────────────────────

/**
 * Submits source code to the remote Judge0 CE sandbox API synchronously using Base64 encoding.
 * 
 * SECURITY REASONING:
 * 1. Base64 Encoding: Transmits source code and stdin via Base64 to support Unicode,
 *    emojis, and non-ASCII character sets without JSON escaping errors or command injection.
 * 2. Strict Limits Injection: Applies `JUDGE0_LIMITS` unconditionally on every API call.
 * 3. Sanitized Decoding: Safely decodes stdout/stderr from Base64 buffers.
 *
 * @async
 * @function submitToJudge0
 * @param {object} params
 * @param {number} params.languageId - Target Judge0 runtime ID
 * @param {string} params.sourceCode - Raw source code string
 * @param {string} [params.stdin=''] - Optional standard input stream
 * @returns {Promise<{ stdout: string, stderr: string, status: object, time: string|null, memory: number|null }>}
 * @throws {Error} When Judge0 API rejects the request or fails
 */
async function submitToJudge0({ languageId, sourceCode, stdin }) {
  const apiUrl  = process.env.JUDGE0_API_URL;
  const apiKey  = process.env.JUDGE0_API_KEY;

  // Base64 encode code and stdin to support emojis/Unicode characters safely
  const base64Code = Buffer.from(sourceCode || '').toString('base64');
  const base64Stdin = Buffer.from(stdin || '').toString('base64');

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey && apiKey.toLowerCase() !== 'none') {
    headers['X-RapidAPI-Key'] = apiKey;
    try {
      headers['X-RapidAPI-Host'] = new URL(apiUrl).host;
    } catch {
      // Ignore URL parse error
    }
  }

  const res = await fetch(`${apiUrl}/submissions?base64_encoded=true&wait=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language_id: languageId,
      source_code: base64Code,
      stdin:        base64Stdin,
      ...JUDGE0_LIMITS,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Judge0 submission failed: ${res.status} — ${errText}`);
  }

  const result = await res.json();

  // Helper to decode Base64 output safely
  const decodeBase64 = (b64) => {
    if (!b64) return '';
    return Buffer.from(b64, 'base64').toString('utf8');
  };

  return {
    stdout: decodeBase64(result.stdout),
    stderr: decodeBase64(result.stderr) || decodeBase64(result.compile_output),
    status: result.status,
    time: result.time,
    memory: result.memory,
  };
}

// ─── Mock Executor (mock mode) ────────────────────────────────────────────────

/**
 * Generates realistic simulated Judge0 execution outcomes without hitting external APIs.
 * Active when `EXECUTION_MOCK_MODE=true` to enable complete API testing without consuming API credits.
 *
 * @function getMockResult
 * @param {string} languageKey - Language identifier
 * @param {string} sourceCode - Submitted code
 * @returns {{ stdout: string, stderr: string, status: { description: string }, time: string|null, memory: number|null }}
 */
function getMockResult(languageKey, sourceCode) {
  // Simulate a timeout for code containing 'while True' or 'for(;;)'
  if (/while\s*\(\s*true\s*\)/i.test(sourceCode) || /while\s+True/.test(sourceCode)) {
    return {
      stdout: '',
      stderr: 'Time Limit Exceeded',
      status: { description: 'Time Limit Exceeded' },
      time: '10.0',
      memory: null,
    };
  }

  // Simulate a compilation error for code containing 'COMPILE_ERROR'
  if (sourceCode.includes('COMPILE_ERROR')) {
    return {
      stdout: '',
      stderr: 'error: expected \';\' before \'}\' token',
      status: { description: 'Compilation Error' },
      time: null,
      memory: null,
    };
  }

  // Default: successful run
  const outputs = {
    javascript: 'Hello from JavaScript!\n',
    python:     'Hello from Python!\n',
    cpp:        'Hello from C++!\n',
    c:          'Hello from C!\n',
    java:       'Hello from Java!\n',
    html:       'HTML/CSS rendered in browser preview.\n',
  };

  return {
    stdout: outputs[languageKey] || 'Program executed successfully.\n',
    stderr: '',
    status: { description: 'Accepted' },
    time: (Math.random() * 0.1 + 0.01).toFixed(3),
    memory: Math.floor(Math.random() * 5000 + 1000),
  };
}

// ─── POST /api/execution/:uuid/run ────────────────────────────────────────────

/**
 * @route   POST /api/execution/:uuid/run
 * @desc    Execute code in a specific room. Broadcasts results via WebSocket (FR-27 – FR-33).
 * @access  Private (Editors and Owners only)
 * 
 * ROLE ENFORCEMENT & SECURITY REASONING (FR-27, NFR-25):
 * 1. Membership Verification: User must be an enrolled participant in `room.participants`.
 * 2. Role Barrier: If `member.role === 'Viewer'`, execution is strictly denied with HTTP 403 Forbidden.
 *    Viewers are read-only observers and must not be allowed to consume server/Judge0 compute
 *    resources, initiate remote code execution, or flood the room's execution history.
 * 3. HTML/CSS Browser Preview Bypass (FR-33): HTML/CSS code is executed directly in the browser's
 *    sandboxed iframe and bypasses the Judge0 remote sandbox entirely, eliminating external latency.
 * 4. WebSocket Broadcast (FR-29): The canonical result is broadcast to all participants in the room
 *    via `global.broadcastToRoom` to provide real-time shared output.
 */
router.post('/:uuid/run', protect, execLimiter, async (req, res) => {
  try {
    const { uuid }       = req.params;
    const { code, language, stdin } = req.body;

    // ── Validate inputs ────────────────────────────────────────────────────────
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ message: 'Please enter some code to execute.' });
    }

    const languageKey = (language || '').toLowerCase().trim();
    const langEntry   = LANGUAGE_MAP[languageKey];
    if (!langEntry) {
      return res.status(400).json({
        message: `The selected language "${language}" is not supported. Supported languages are: JavaScript, Python, C++, C, Java, and HTML.`,
      });
    }

    // ── Membership & Role Guard (NFR-25) ───────────────────────────────────────
    const room = await Room.findOne({ uuid }).populate('participants.user', 'displayName email');
    if (!room) return res.status(404).json({ message: 'The specified room could not be found.' });

    const member = room.participants.find(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });

    if (!member) {
      return res.status(403).json({ message: 'You do not have access to run code in this room.' });
    }

    // Security: Viewers cannot execute code (FR-27). Prevents compute abuse by read-only users.
    if (member.role === 'Viewer') {
      return res.status(403).json({ message: 'Viewers cannot execute code. Ask the Room Leader or Owner to promote you to Editor.' });
    }

    // ── Execute ────────────────────────────────────────────────────────────────
    let rawResult;
    const isMock = process.env.EXECUTION_MOCK_MODE === 'true';

    // FR-33: HTML/CSS executes client-side in a sandboxed iframe without remote compilation
    if (languageKey === 'html' || langEntry.id === null) {
      rawResult = {
        stdout: 'HTML/CSS is executed directly in the browser preview pane (FR-33).\nNo remote sandbox compilation required.\n',
        stderr: '',
        status: { description: 'Accepted' },
        time: '0.001',
        memory: 0,
      };
    } else if (isMock) {
      // Small simulated delay for realism in mock mode
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      rawResult = getMockResult(languageKey, code);
    } else {
      rawResult = await submitToJudge0({
        languageId: langEntry.id,
        sourceCode: code,
        stdin:      stdin || '',
      });
    }

    // ── Build canonical result payload ─────────────────────────────────────────
    const executorUser = room.participants.find(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });

    const result = {
      triggeredBy: executorUser.user.displayName,
      language:    langEntry.name,
      languageId:  langEntry.id,
      stdout:      rawResult.stdout  || '',
      stderr:      rawResult.stderr  || '',
      status:      rawResult.status?.description || rawResult.status || 'Unknown',
      time:        rawResult.time    || null,
      memory:      rawResult.memory  || null,
      isMock,
      ranAt:       new Date().toISOString(),
    };

    // ── Persist to Room.executionHistory (FR-35, capped at MAX_EXEC_HISTORY) ────
    room.executionHistory.push({
      triggeredBy: result.triggeredBy,
      language:    langEntry.name,
      languageId:  langEntry.id,
      stdout:      result.stdout,
      stderr:      result.stderr,
      status:      result.status,
      time:        result.time,
      memory:      result.memory,
    });

    // Trim to keep only the last N results (NFR-37)
    if (room.executionHistory.length > MAX_EXEC_HISTORY) {
      room.executionHistory = room.executionHistory.slice(-MAX_EXEC_HISTORY);
    }

    await room.save();

    // ── Broadcast to all room WebSocket connections (FR-29) ───────────────────
    if (typeof global.broadcastToRoom === 'function') {
      global.broadcastToRoom(uuid, JSON.stringify({ type: 'exec:result', payload: result }));
    }

    logger.info(`Execution in room [${result.language}] — ${result.status} (${isMock ? 'MOCK' : 'REAL'})`, { userId: req.user._id, roomId: uuid });

    return res.status(200).json({ result });
  } catch (err) {
    return sendPlainEnglishError(res, err, 'An error occurred while executing your code. Please try again.');
  }
});

// ─── GET /api/execution/:uuid/history ─────────────────────────────────────────

/**
 * @route   GET /api/execution/:uuid/history
 * @desc    Return the last N execution results for a room (FR-35).
 * @access  Private (Any room member)
 * 
 * SECURITY REASONING:
 * Sourced from MongoDB `executionHistory`. Allows late-joining members to hydrate their
 * output console with recent run history. Strictly verified by membership guard (NFR-25).
 */
router.get('/:uuid/history', protect, async (req, res) => {
  try {
    const { uuid } = req.params;
    const room = await Room.findOne({ uuid }, 'participants executionHistory');
    if (!room) return res.status(404).json({ message: 'The specified room could not be found.' });

    // Security: Verify requesting user is a member of the room
    const isMember = room.participants.some(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });

    if (!isMember) {
      return res.status(403).json({ message: 'You do not have access to view execution history in this room.' });
    }

    return res.status(200).json({ history: room.executionHistory });
  } catch (err) {
    return sendPlainEnglishError(res, err, 'An error occurred while retrieving execution history. Please try again.');
  }
});

router.LANGUAGE_MAP = LANGUAGE_MAP;
router.JUDGE0_LIMITS = JUDGE0_LIMITS;
router.MAX_EXEC_HISTORY = MAX_EXEC_HISTORY;
router.execLimiter = execLimiter;
router.getMockResult = getMockResult;
router.submitToJudge0 = submitToJudge0;

module.exports = router;
module.exports.LANGUAGE_MAP = LANGUAGE_MAP;
module.exports.JUDGE0_LIMITS = JUDGE0_LIMITS;
module.exports.MAX_EXEC_HISTORY = MAX_EXEC_HISTORY;
module.exports.execLimiter = execLimiter;
module.exports.getMockResult = getMockResult;
module.exports.submitToJudge0 = submitToJudge0;

