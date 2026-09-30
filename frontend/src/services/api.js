/**
 * @file services/api.js
 * @module services/api
 * @description Frontend REST API Client for CollabIDE backend services.
 * 
 * Provides:
 * - Centralized fetch wrapper with automatic JWT Bearer header injection
 * - Proactive token refresh scheduling prior to 15-minute access token expiration
 * - Concurrent request synchronization during refresh locks
 * - HTTP 429 rate limit error handling and dispatch
 * - Public API wrappers for Authentication, Workspace Rooms, Code Execution, and Voice Signalling
 */

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? '/api' 
  : 'https://collabide-backend-avau.onrender.com/api';

let accessToken = null;
let refreshTimeoutId = null;
let refreshPromise = null;
let csrfPromise = null;

export function getCsrfToken() {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function ensureCsrfToken() {
  const existing = getCsrfToken();
  if (existing) return existing;

  if (csrfPromise) return csrfPromise;

  csrfPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/csrf-token`, {
        method: 'GET',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        return data.csrfToken || getCsrfToken();
      }
      return getCsrfToken();
    } catch (e) {
      return getCsrfToken();
    } finally {
      csrfPromise = null;
    }
  })();

  return csrfPromise;
}

/**
 * Decodes and parses a JWT payload without external library dependencies.
 *
 * @function parseJwt
 * @param {string} token - Raw JWT string
 * @returns {object|null} Decoded JSON claims payload or null on decode failure
 */
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => 
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

/**
 * Requests a new access token using the HTTP-only refresh cookie (NFR-12, NFR-13).
 * Employs a mutex promise to prevent concurrent overlapping refresh calls.
 *
 * @async
 * @function refreshSession
 * @returns {Promise<string|null>} Fresh access token or null on failure
 */
export async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  
  refreshPromise = (async () => {
    try {
      const csrfToken = await ensureCsrfToken();
      const headers = {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setToken(refreshData.accessToken);
        return refreshData.accessToken;
      } else {
        // Only log out if it's explicitly an auth failure, NOT a rate limit (429) or server error (500)
        if (refreshRes.status === 401 || refreshRes.status === 403) {
          setToken(null);
          window.dispatchEvent(new Event('auth-expired'));
        } else if (refreshRes.status === 429) {
          try {
            const data = await refreshRes.json();
            window.dispatchEvent(new CustomEvent('api-error', { detail: data.message || 'API rate limit exceeded.' }));
          } catch(e) {}
        }
        return null;
      }
    } catch (e) {
      // Network errors should not wipe the session
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
}

/**
 * Stores the active in-memory access token and schedules proactive background refresh.
 * Triggers refresh 60 seconds before token expiration.
 *
 * @function setToken
 * @param {string|null} token - JWT access token or null to clear
 */
export function setToken(token) {
  accessToken = token;
  if (refreshTimeoutId) {
    clearTimeout(refreshTimeoutId);
    refreshTimeoutId = null;
  }

  if (token) {
    const payload = parseJwt(token);
    if (payload && payload.exp) {
      const timeUntilExpiry = (payload.exp * 1000) - Date.now();
      const delay = Math.max(0, timeUntilExpiry - 60000); // Trigger 1 min before expiry
      refreshTimeoutId = setTimeout(() => {
        refreshSession();
      }, delay);
    }
  }
}

/**
 * Retrieves the current in-memory JWT access token.
 *
 * @function getToken
 * @returns {string|null} Current JWT access token
 */
export function getToken() {
  return accessToken;
}

/**
 * Sanitizes any error (network failure, exception, or API message) into a plain English sentence (NFR-47).
 * Ensures zero technical jargon, stack traces, or raw error codes reach the user interface.
 *
 * @function formatErrorMessage
 * @param {Error|string|unknown} err - Error instance or message
 * @param {string} [fallback='An unexpected error occurred. Please try again.'] - User-friendly fallback
 * @returns {string} Clean plain-English error message
 */
export function formatErrorMessage(err, fallback = 'An unexpected error occurred. Please try again.') {
  if (!err) return fallback;

  // Google OAuth popup closed or blocked
  if (err?.error === 'popup_closed_by_user' || err?.type === 'popup_closed') {
    return 'Google sign-in window was closed. Please try again.';
  }

  let msg = '';
  if (typeof err === 'string') {
    msg = err;
  } else if (err instanceof Error) {
    msg = err.message || '';
  } else if (typeof err === 'object') {
    if (err.message) {
      msg = String(err.message);
    } else if (typeof err.error === 'string') {
      msg = err.error;
    } else {
      return fallback;
    }
  } else {
    return fallback;
  }

  // Strip technical prefix if present
  msg = msg.replace(/^Error:\s*/i, '').trim();

  // Network connection failures
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('net::ERR_') ||
    msg.includes('Load failed') ||
    msg.includes('Network request failed')
  ) {
    return 'Unable to connect to the server. Please check your internet connection.';
  }

  // JSON syntax errors or HTML doctype in responses
  if (msg.includes('Unexpected token') || msg.includes('is not valid JSON')) {
    return 'The server response could not be processed. Please try again later.';
  }

  // Internal JavaScript engine errors
  if (
    msg.includes('Cannot read properties of') ||
    msg.includes('is not a function') ||
    msg.includes('is undefined') ||
    msg.includes('is null') ||
    msg.includes('TypeError:') ||
    msg.includes('ReferenceError:')
  ) {
    return fallback;
  }

  // Aborted or cancelled request
  if (err?.name === 'AbortError' || msg.includes('aborted') || msg.includes('cancelled')) {
    return 'Request was cancelled or timed out. Please try again.';
  }

  // Google OAuth popup closed or blocked
  if (err?.error === 'popup_closed_by_user' || err?.type === 'popup_closed' || msg.includes('popup_closed')) {
    return 'Google sign-in window was closed. Please try again.';
  }

  // Raw database or internal error codes
  if (
    /E\d{4,5}/.test(msg) ||
    msg.includes('MongoServerError') ||
    msg.includes('CastError') ||
    msg.includes('BSONTypeError') ||
    msg.includes('ECONNREFUSED')
  ) {
    return fallback;
  }

  // Stack trace frames or file paths
  if (/\bat\s+[A-Za-z0-9_./\\-]+\s*\(?/.test(msg) || /[a-zA-Z]:\\[a-zA-Z0-9_\-\\]+/.test(msg) || /\/(?:var|home|usr|app)\//.test(msg)) {
    return fallback;
  }

  return msg || fallback;
}

/**
 * Safely parses response JSON, falling back to a plain-English message if parsing fails.
 *
 * @async
 * @function safeJson
 * @param {Response} res - Fetch response
 * @param {string} [fallback='An unexpected server error occurred. Please try again.']
 * @returns {Promise<any>} Parsed data
 */
async function safeJson(res, fallback = 'An unexpected server error occurred. Please try again.') {
  try {
    return await res.json();
  } catch (e) {
    throw new Error(fallback);
  }
}

/**
 * Core authenticated HTTP request helper.
 * Attaches Authorization header, waits on pending refreshes, and handles 401/429 status codes.
 *
 * @async
 * @function request
 * @param {string} path - Target API endpoint path
 * @param {RequestInit} [options={}] - Standard Fetch options
 * @returns {Promise<Response>} Fetch Response object
 */
async function request(path, options = {}) {
  // Wait if a proactive refresh is currently running
  if (refreshPromise) {
    await refreshPromise;
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (networkError) {
    throw new Error('Unable to connect to the server. Please check your internet connection.');
  }

  if (res.status === 429) {
    try {
      const clone = res.clone();
      const data = await clone.json();
      window.dispatchEvent(new CustomEvent('api-error', { detail: data.message || 'You have made too many requests. Please wait a moment.' }));
    } catch(e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: 'You have made too many requests. Please wait a moment.' }));
    }
  }

  // Fallback: If proactive refresh missed it and we got 401, refresh and retry
  if (res.status === 401 && accessToken) {
    const newToken = await refreshSession();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      try {
        return await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
      } catch (retryError) {
        throw new Error('Unable to connect to the server. Please check your internet connection.');
      }
    }
  }

  return res;
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

/**
 * Fetches public authentication configuration (Google OAuth client ID).
 *
 * @async
 * @function getAuthConfig
 * @returns {Promise<{ googleClientId: string|null }>} Auth configuration object
 */
export async function getAuthConfig() {
  const res = await request('/auth/config');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch auth config');
  return data;
}

/**
 * Verifies if an email address is already registered in the system.
 *
 * @async
 * @function checkEmail
 * @param {string} email - Email address to check
 * @returns {Promise<{ exists: boolean }>} Existence indicator
 */
export async function checkEmail(email) {
  const res = await request(`/auth/check-email?email=${encodeURIComponent(email)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Email check failed');
  return data;
}

/**
 * Authenticates user via Google OAuth 2.0 access token (FR-02).
 *
 * @async
 * @function googleLogin
 * @param {string} accessToken - Google OAuth access token
 * @returns {Promise<{ user: object, accessToken: string }>} User session payload
 */
export async function googleLogin(accessToken) {
  const res = await request('/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({ accessToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Google login failed');
  setToken(data.accessToken);
  return data;
}

/**
 * Registers a new user account and triggers email verification token delivery (FR-01).
 *
 * @async
 * @function registerUser
 * @param {object} params
 * @param {string} params.email - User email address
 * @param {string} params.password - Plain text password meeting complexity policy
 * @param {string} params.displayName - Visible user display name
 * @param {string} [params.avatarColor] - Assigned avatar color
 * @returns {Promise<{ message: string }>} Registration confirmation message
 */
export async function registerUser({ email, password, displayName, avatarColor }) {
  const res = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName, avatarColor }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Registration failed');
  return data;
}

/**
 * Authenticates user with email and password credentials (FR-01).
 *
 * @async
 * @function loginUser
 * @param {object} credentials
 * @param {string} credentials.email - User email
 * @param {string} credentials.password - User password
 * @returns {Promise<{ user: object, accessToken: string }>} Authenticated user payload
 */
export async function loginUser({ email, password }) {
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  setToken(data.accessToken);
  return data;
}

/**
 * Logs out the current session and clears the in-memory access token.
 *
 * @async
 * @function logoutUser
 * @returns {Promise<void>}
 */
export async function logoutUser() {
  await request('/auth/logout', { method: 'POST' });
  setToken(null);
}

/**
 * Revokes all refresh tokens and active sessions for the user across all devices (FR-07).
 *
 * @async
 * @function logoutAllDevices
 * @returns {Promise<void>}
 */
export async function logoutAllDevices() {
  await request('/auth/logout-all', { method: 'POST' });
  setToken(null);
}

/**
 * Retrieves the currently authenticated user's profile details.
 *
 * @async
 * @function getProfile
 * @returns {Promise<object>} Authenticated user profile document
 */
export async function getProfile() {
  const res = await request('/auth/me');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to get profile');
  return data.user;
}

/**
 * Requests a password reset email token for an account (FR-09).
 *
 * @async
 * @function requestPasswordReset
 * @param {string} email - Registered account email
 * @returns {Promise<{ message: string }>} Dispatch confirmation
 */
export async function requestPasswordReset(email) {
  const res = await request('/auth/reset-password-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to request password reset');
  return data;
}

/**
 * Validates a password reset token for validity and expiration (FR-09).
 *
 * @async
 * @function validateResetToken
 * @param {string} token - Reset token string
 * @returns {Promise<{ valid: boolean }>} Validity result
 */
export async function validateResetToken(token) {
  const res = await request(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Invalid or expired reset token');
  return data;
}

/**
 * Sets a new password using a validated password reset token (FR-09).
 *
 * @async
 * @function resetPassword
 * @param {object} params
 * @param {string} params.token - Valid reset token
 * @param {string} params.newPassword - New password
 * @returns {Promise<{ message: string }>} Success message
 */
export async function resetPassword({ token, newPassword }) {
  const res = await request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to reset password');
  return data;
}

/**
 * Validates password complexity and checks HaveIBeenPwned breach database via k-anonymity (NFR-16).
 *
 * @async
 * @function validatePasswordApi
 * @param {string} password - Candidate password
 * @returns {Promise<{ isValid: boolean, message?: string, errors?: string[], isPwned?: boolean, breachCount?: number, details?: object }>}
 */
export async function validatePasswordApi(password) {
  const res = await request('/auth/validate-password', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Password validation failed');
  return data;
}

/**
 * Updates password for authenticated user (NFR-16).
 *
 * @async
 * @function changePassword
 * @param {object} params
 * @param {string} params.currentPassword - Current user password
 * @param {string} params.newPassword - New password meeting complexity and breach policy
 * @returns {Promise<{ message: string }>} Success confirmation
 */
export async function changePassword({ currentPassword, newPassword }) {
  const res = await request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to update password');
  return data;
}

/**
 * Updates user profile details such as display name, avatar color, and persisted theme (FR-08, FR-24).
 *
 * @async
 * @function updateProfile
 * @param {object} updates
 * @param {string} [updates.displayName] - Updated display name
 * @param {string} [updates.avatarColor] - Updated avatar color
 * @param {string} [updates.theme] - Persisted theme ('vs-dark' | 'light')
 * @returns {Promise<object>} Updated user profile
 */
export async function updateProfile({ displayName, avatarColor, theme }) {
  const res = await request('/auth/profile', {
    method: 'PUT',
    body: JSON.stringify({ displayName, avatarColor, theme }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to update profile');
  return data.user;
}

/**
 * Requests an email address change with verification confirmation link (FR-08).
 *
 * @async
 * @function requestEmailChange
 * @param {string} newEmail - New destination email address
 * @returns {Promise<{ message: string }>} Success response
 */
export async function requestEmailChange(newEmail) {
  const res = await request('/auth/change-email', {
    method: 'POST',
    body: JSON.stringify({ newEmail }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to request email change');
  return data;
}

/**
 * Cancels a pending unverified email change request (FR-08).
 *
 * @async
 * @function cancelEmailChange
 * @returns {Promise<object>} User profile with cleared pending email
 */
export async function cancelEmailChange() {
  const res = await request('/auth/cancel-email-change', {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to cancel email change');
  return data.user;
}

/**
 * Retrieves the list of active user sessions across all devices (FR-07).
 *
 * @async
 * @function getSessions
 * @returns {Promise<Array<object>>} List of active session records
 */
export async function getSessions() {
  const res = await request('/auth/sessions');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to get sessions');
  return data.sessions;
}

/**
 * Revokes a specific session by ID (FR-07).
 *
 * @async
 * @function revokeSession
 * @param {string} id - Session identifier to invalidate
 * @returns {Promise<{ message: string }>} Confirmation message
 */
export async function revokeSession(id) {
  const res = await request(`/auth/sessions/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to revoke session');
  return data;
}

/**
 * Revokes all other active sessions except the current one (FR-07).
 *
 * @async
 * @function revokeAllOtherSessions
 * @returns {Promise<{ message: string }>} Confirmation message
 */
export async function revokeAllOtherSessions() {
  const res = await request('/auth/sessions', { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to revoke other sessions');
  return data;
}

// ─── ROOMS ENDPOINTS ──────────────────────────────────────────────────────────

/**
 * Fetches all rooms the current user is an enrolled participant of (FR-14).
 *
 * @async
 * @function getRooms
 * @param {string} [search=''] - Optional search query filtering by room name or UUID
 * @returns {Promise<Array<object>>} List of room summaries
 */
export async function getRooms(search = '') {
  const query = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  const res = await request(`/rooms${query}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch rooms');
  return Array.isArray(data) ? data : (data.rooms || []);
}

/**
 * Polls lightweight room presence and last-active metrics without fetching full file trees (FR-14).
 *
 * @async
 * @function getRoomsPresence
 * @returns {Promise<Record<string, { onlineCount: number, lastActiveAt: string }>>} Presence map keyed by roomUuid
 */
export async function getRoomsPresence() {
  const res = await request('/rooms/presence');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch room presence');
  return data.presence || {};
}

/**
 * Creates a new collaborative room workspace (FR-10).
 *
 * @async
 * @function createRoom
 * @param {string} name - Room workspace name
 * @returns {Promise<object>} Created room record
 */
export async function createRoom(name) {
  const res = await request('/rooms', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to create room');
  return data;
}

/**
 * Joins a room workspace via room UUID invite link (FR-11).
 *
 * @async
 * @function joinRoom
 * @param {string} uuid - Target room UUID
 * @returns {Promise<{ message: string, role: string }>} Enrollment response
 */
export async function joinRoom(uuid) {
  const res = await request(`/rooms/${uuid}/join`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to join room');
  return data;
}

/**
 * Fetches full room workspace details, files, and caller's collaborative role.
 *
 * @async
 * @function getRoomDetails
 * @param {string} uuid - Room UUID
 * @returns {Promise<{ room: object, myRole: string }>} Room details payload
 */
export async function getRoomDetails(uuid) {
  const res = await request(`/rooms/${uuid}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch room details');
  return data;
}

/**
 * Changes a room participant's collaborative role (FR-39).
 *
 * @async
 * @function promoteMember
 * @param {string} uuid - Room UUID
 * @param {string} targetUserId - Target user ID
 * @param {string} role - New role ('Room Leader' | 'Editor' | 'Viewer')
 * @returns {Promise<object>} Update response
 */
export async function promoteMember(uuid, targetUserId, role) {
  const res = await request(`/rooms/${uuid}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ targetUserId, newRole: role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to change role');
  return data;
}

/**
 * Closes a room to make it read-only for all participants (FR-42).
 *
 * @async
 * @function closeRoom
 * @param {string} uuid - Room UUID
 * @returns {Promise<object>} Closure confirmation
 */
export async function closeRoom(uuid) {
  const res = await request(`/rooms/${uuid}/close`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to close room');
  return data;
}

/**
 * Re-opens a closed room to resume collaborative editing (FR-42).
 *
 * @async
 * @function openRoom
 * @param {string} uuid - Room UUID
 * @returns {Promise<object>} Reopen confirmation
 */
export async function openRoom(uuid) {
  const res = await request(`/rooms/${uuid}/open`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to open room');
  return data;
}

/**
 * Permanently deletes a room and its documents (FR-43).
 *
 * @async
 * @function deleteRoom
 * @param {string} uuid - Room UUID
 * @returns {Promise<object>} Deletion confirmation
 */
export async function deleteRoom(uuid) {
  const res = await request(`/rooms/${uuid}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to delete room');
  return data;
}

// ─── EXECUTION ENDPOINTS ──────────────────────────────────────────────────────

/**
 * Submits code for sandbox execution in a room (FR-27 – FR-33).
 *
 * @async
 * @function runCode
 * @param {string} uuid - Room UUID
 * @param {object} params
 * @param {string} params.code - Source code string
 * @param {string} params.language - Language key ('javascript' | 'python' | 'cpp' | 'c' | 'java' | 'html')
 * @param {string} [params.stdin] - Optional stdin input
 * @returns {Promise<object>} Execution outcome payload
 */
export async function runCode(uuid, { code, language, stdin }) {
  const res = await request(`/execution/${uuid}/run`, {
    method: 'POST',
    body: JSON.stringify({ code, language, stdin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Execution error');
  return data.result;
}

/**
 * Fetches persisted execution history for a room (FR-35).
 *
 * @async
 * @function getExecutionHistory
 * @param {string} uuid - Room UUID
 * @returns {Promise<Array<object>>} List of historical execution outcomes
 */
export async function getExecutionHistory(uuid) {
  const res = await request(`/execution/${uuid}/history`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch execution history');
  return data.history;
}

// ─── VOICE CREDENTIALS ────────────────────────────────────────────────────────

/**
 * Requests ephemeral time-limited TURN/STUN credentials for WebRTC peer connections (NFR-30).
 *
 * @async
 * @function getVoiceCredentials
 * @param {string} uuid - Room UUID
 * @returns {Promise<{ iceServers: Array<RTCIceServer>, credentials: object }>} RTCConfiguration credentials
 */
export async function getVoiceCredentials(uuid) {
  const res = await request(`/voice/${uuid}/credentials`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch voice credentials');
  return data;
}

/**
 * Retrieves current voice channel participants and channel mode settings.
 *
 * @async
 * @function getVoiceParticipants
 * @param {string} uuid - Room UUID
 * @returns {Promise<{ participants: Array<object>, editorOnlyMode: boolean }>} Channel participants and settings
 */
export async function getVoiceParticipants(uuid) {
  const res = await request(`/voice/${uuid}/participants`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch voice participants');
  return data;
}
