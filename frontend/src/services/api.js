/**
 * services/api.js
 *
 * REST API Client for CollabIDE backend REST routes.
 * Automatically handles JWT header attachment.
 */

const API_BASE = '/api';

let accessToken = localStorage.getItem('token') || null;

export function setToken(token) {
  accessToken = token;
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

export function getToken() {
  return accessToken;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Automatically handle token refresh rotation (NFR-13) if unauthorized
  if (res.status === 401 && accessToken) {
    // Attempt token refresh
    try {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST' });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setToken(refreshData.accessToken);
        // Retry the original request
        headers['Authorization'] = `Bearer ${refreshData.accessToken}`;
        return fetch(`${API_BASE}${path}`, { ...options, headers });
      } else {
        // Clear token and redirect to login if refresh fails
        setToken(null);
        window.dispatchEvent(new Event('auth-expired'));
      }
    } catch (e) {
      setToken(null);
      window.dispatchEvent(new Event('auth-expired'));
    }
  }

  return res;
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

export async function registerUser({ email, password, displayName, avatarColor }) {
  const res = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName, avatarColor }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Registration failed');
  return data;
}

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

export async function logoutUser() {
  await request('/auth/logout', { method: 'POST' });
  setToken(null);
}

export async function getProfile() {
  const res = await request('/auth/me');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to get profile');
  return data.user;
}

// ─── ROOMS ENDPOINTS ──────────────────────────────────────────────────────────

export async function createRoom(name) {
  const res = await request('/rooms', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to create room');
  return data;
}

export async function joinRoom(uuid) {
  const res = await request(`/rooms/${uuid}/join`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to join room');
  return data;
}

export async function getRoomDetails(uuid) {
  const res = await request(`/rooms/${uuid}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch room details');
  return data; // { room, myRole }
}

export async function promoteMember(uuid, targetUserId, role) {
  const res = await request(`/rooms/${uuid}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ targetUserId, newRole: role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to change role');
  return data;
}

// ─── EXECUTION ENDPOINTS ──────────────────────────────────────────────────────

export async function runCode(uuid, { code, language, stdin }) {
  const res = await request(`/execution/${uuid}/run`, {
    method: 'POST',
    body: JSON.stringify({ code, language, stdin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Execution error');
  return data.result;
}

export async function getExecutionHistory(uuid) {
  const res = await request(`/execution/${uuid}/history`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch execution history');
  return data.history;
}

// ─── VOICE CREDENTIALS ────────────────────────────────────────────────────────

export async function getVoiceCredentials(uuid) {
  const res = await request(`/voice/${uuid}/credentials`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch voice credentials');
  return data;
}

export async function getVoiceParticipants(uuid) {
  const res = await request(`/voice/${uuid}/participants`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch voice participants');
  return data; // { participants, editorOnlyMode }
}
