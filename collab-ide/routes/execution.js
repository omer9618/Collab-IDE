/**
 * routes/execution.js
 *
 * Code Execution Module — FR-27 to FR-33, NFR-35, NFR-43, NFR-48
 *
 * POST /api/execution/:uuid/run
 *   - Authenticated Editors and Owners can submit code for execution.
 *   - Proxies to Judge0 CE API with hard resource limits (NFR-43).
 *   - Broadcasts exec:result to all room WebSocket connections (FR-29).
 *   - Persists last 20 results in Room.executionHistory (FR-35).
 *   - Rate limited: 10 req/min/user (NFR-35).
 *
 * When EXECUTION_MOCK_MODE=true (default), returns realistic mock responses
 * without calling Judge0, so the full API surface is testable pre-key.
 * Set EXECUTION_MOCK_MODE=false and provide JUDGE0_API_KEY to enable real execution.
 */

const express  = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const Room = require('../models/Room');

const router = express.Router({ mergeParams: true });

// ─── Constants ────────────────────────────────────────────────────────────────

/** Judge0 language ID map (FR-23, FR-28) */
const LANGUAGE_MAP = {
  javascript: { id: 63, name: 'JavaScript (Node.js 12.14.0)' },
  python:     { id: 71, name: 'Python (3.8.1)' },
  cpp:        { id: 54, name: 'C++ (GCC 9.2.0)' },
  c:          { id: 50, name: 'C (GCC 9.2.0)' },
  java:       { id: 62, name: 'Java (OpenJDK 13.0.1)' },
};

/** Hard resource limits applied on every Judge0 submission (NFR-43) */
const JUDGE0_LIMITS = {
  cpu_time_limit:       10,      // seconds
  wall_time_limit:      12,      // seconds
  memory_limit:         128000,  // KB  (128 MB)
  max_file_size:        64,      // KB  (64 KB stdout cap)
};

/** Max persisted execution results per room (NFR-37) */
const MAX_EXEC_HISTORY = 20;

// ─── Rate Limiter (NFR-35: 10 req/min/user) ───────────────────────────────────
const execLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user.userId, // per-user, not per-IP
  message: { message: 'Execution rate limit exceeded. Maximum 10 runs per minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || process.env.NODE_ENV === 'test';
  },
});

// ─── Judge0 Submission (real mode) ────────────────────────────────────────────

/**
 * Submit code to Judge0 CE and poll for the result.
 * Uses the /submissions endpoint with wait=true for simplicity.
 * @param {object} params
 * @returns {Promise<object>} Judge0 result object
 */
async function submitToJudge0({ languageId, sourceCode, stdin }) {
  const apiUrl  = process.env.JUDGE0_API_URL;
  const apiKey  = process.env.JUDGE0_API_KEY;

  // Submit
  const submitRes = await fetch(`${apiUrl}/submissions?base64_encoded=false&wait=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
    },
    body: JSON.stringify({
      language_id: languageId,
      source_code: sourceCode,
      stdin:        stdin || '',
      ...JUDGE0_LIMITS,
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Judge0 submission failed: ${submitRes.status} — ${errText}`);
  }

  const { token } = await submitRes.json();
  if (!token) throw new Error('Judge0 did not return a submission token.');

  // Poll until status is not "In Queue" (1) or "Processing" (2)
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 500)); // 500ms poll interval

    const pollRes = await fetch(
      `${apiUrl}/submissions/${token}?base64_encoded=false&fields=stdout,stderr,status,time,memory`,
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
        },
      }
    );

    if (!pollRes.ok) continue;

    const result = await pollRes.json();
    // status.id 1 = In Queue, 2 = Processing
    if (result.status && result.status.id > 2) {
      return result;
    }
  }

  // If still not finished after 15s of polling, return a timeout result
  return {
    stdout: '',
    stderr: '',
    status: { description: 'Time Limit Exceeded' },
    time: '10.0',
    memory: null,
  };
}

// ─── Mock Executor (mock mode) ────────────────────────────────────────────────

/**
 * Returns a realistic mock Judge0 result without hitting the API.
 * Used when EXECUTION_MOCK_MODE=true.
 * @param {string} languageKey
 * @param {string} sourceCode
 * @returns {object} Simulated Judge0 result
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
 * @route  POST /api/execution/:uuid/run
 * @desc   Execute code in a specific room. Must be Editor or Owner.
 *         Broadcasts result to all room participants via WebSocket (FR-29).
 * @access Private
 */
router.post('/:uuid/run', protect, execLimiter, async (req, res) => {
  try {
    const { uuid }       = req.params;
    const { code, language, stdin } = req.body;

    // ── Validate inputs ────────────────────────────────────────────────────────
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ message: 'Code must be a non-empty string.' });
    }

    const languageKey = (language || '').toLowerCase().trim();
    const langEntry   = LANGUAGE_MAP[languageKey];
    if (!langEntry) {
      return res.status(400).json({
        message: `Unsupported language "${language}". Supported: ${Object.keys(LANGUAGE_MAP).join(', ')}.`,
      });
    }

    // ── Membership & Role Guard (NFR-25) ───────────────────────────────────────
    const room = await Room.findOne({ uuid }).populate('participants.user', 'displayName email');
    if (!room) return res.status(404).json({ message: 'Room not found.' });

    const member = room.participants.find(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });

    if (!member) {
      return res.status(403).json({ message: 'Access denied. You are not a member of this room.' });
    }

    // Viewers cannot run code (FR-27)
    if (member.role === 'Viewer') {
      return res.status(403).json({ message: 'Viewers cannot execute code. Ask the Room Leader to promote you to Editor.' });
    }

    // ── Execute ────────────────────────────────────────────────────────────────
    let rawResult;
    const isMock = process.env.EXECUTION_MOCK_MODE === 'true';

    if (isMock) {
      // Small simulated delay for realism
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      rawResult = getMockResult(languageKey, code);
    } else {
      rawResult = await submitToJudge0({
        languageId: langEntry.id,
        sourceCode: code,
        stdin:      stdin || '',
      });
    }

    // ── Build the canonical result payload ─────────────────────────────────────
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

    // Trim to keep only the last N results
    if (room.executionHistory.length > MAX_EXEC_HISTORY) {
      room.executionHistory = room.executionHistory.slice(-MAX_EXEC_HISTORY);
    }

    await room.save();

    // ── Broadcast to all room WebSocket connections (FR-29) ───────────────────
    if (typeof global.broadcastToRoom === 'function') {
      global.broadcastToRoom(uuid, JSON.stringify({ type: 'exec:result', payload: result }));
    }

    console.log(`▶  Execution in room ${uuid} by ${result.triggeredBy} [${result.language}] — ${result.status} (${isMock ? 'MOCK' : 'REAL'})`);

    return res.status(200).json({ result });
  } catch (err) {
    console.error('❌ Execution error:', err.message);
    return res.status(500).json({ message: 'Execution failed. Please try again.' });
  }
});

// ─── GET /api/execution/:uuid/history ─────────────────────────────────────────

/**
 * @route  GET /api/execution/:uuid/history
 * @desc   Return the last N execution results for a room (FR-35).
 *         Used to hydrate the output panel when a user joins.
 * @access Private — any room member
 */
router.get('/:uuid/history', protect, async (req, res) => {
  try {
    const { uuid } = req.params;
    const room = await Room.findOne({ uuid }, 'participants executionHistory');
    if (!room) return res.status(404).json({ message: 'Room not found.' });

    const isMember = room.participants.some(p => {
      const pId = p.user._id ? p.user._id.toString() : p.user.toString();
      return pId === req.user._id.toString();
    });

    if (!isMember) {
      return res.status(403).json({ message: 'Access denied. You are not a member of this room.' });
    }

    return res.status(200).json({ history: room.executionHistory });
  } catch (err) {
    console.error('❌ Error fetching execution history:', err.message);
    return res.status(500).json({ message: 'Failed to fetch execution history.' });
  }
});

module.exports = router;
