/**
 * services/api.js
 *
 * REST API Client for CollabIDE backend REST routes.
 * Automatically handles JWT header attachment.
 */

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? '/api' 
  : 'https://collabide-backend-avau.onrender.com/api';

let accessToken = null;
let refreshTimeoutId = null;
let refreshPromise = null;

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

export async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  
  refreshPromise = (async () => {
    try {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setToken(refreshData.accessToken);
        return refreshData.accessToken;
      } else {
        setToken(null);
        window.dispatchEvent(new Event('auth-expired'));
        return null;
      }
    } catch (e) {
      setToken(null);
      window.dispatchEvent(new Event('auth-expired'));
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
}

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

export function getToken() {
  return accessToken;
}

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

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Fallback: If proactive refresh missed it and we got 401, refresh and retry
  if (res.status === 401 && accessToken) {
    const newToken = await refreshSession();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      return fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
    }
  }

  return res;
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────

export async function getAuthConfig() {
  const res = await request('/auth/config');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch auth config');
  return data;
}

export async function checkEmail(email) {
  const res = await request(`/auth/check-email?email=${encodeURIComponent(email)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Email check failed');
  return data;
}

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

export async function logoutAllDevices() {
  await request('/auth/logout-all', { method: 'POST' });
  setToken(null);
}

export async function getProfile() {
  const res = await request('/auth/me');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to get profile');
  return data.user;
}

export async function requestPasswordReset(email) {
  const res = await request('/auth/reset-password-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to request password reset');
  return data;
}

export async function validateResetToken(token) {
  const res = await request(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Invalid or expired reset token');
  return data;
}

export async function resetPassword({ token, newPassword }) {
  const res = await request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to reset password');
  return data;
}

export async function updateProfile({ displayName, avatarColor }) {
  const res = await request('/auth/profile', {
    method: 'PUT',
    body: JSON.stringify({ displayName, avatarColor }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to update profile');
  return data.user;
}

export async function requestEmailChange(newEmail) {
  const res = await request('/auth/change-email', {
    method: 'POST',
    body: JSON.stringify({ newEmail }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to request email change');
  return data;
}

export async function cancelEmailChange() {
  const res = await request('/auth/cancel-email-change', {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to cancel email change');
  return data.user;
}

export async function getSessions() {
  const res = await request('/auth/sessions');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to get sessions');
  return data.sessions;
}

export async function revokeSession(id) {
  const res = await request(`/auth/sessions/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to revoke session');
  return data;
}

export async function revokeAllOtherSessions() {
  const res = await request('/auth/sessions', { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to revoke other sessions');
  return data;
}

// ─── ROOMS ENDPOINTS ──────────────────────────────────────────────────────────

export async function getRooms() {
  const res = await request('/rooms');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch rooms');
  return Array.isArray(data) ? data : (data.rooms || []);
}

/**
 * FR-14: poll only the live bits (online counts + last active time) so the
 * dashboard can stay fresh without re-fetching every room's file list.
 * Returns a map of { [roomUuid]: { onlineCount, lastActiveAt } }.
 */
export async function getRoomsPresence() {
  const res = await request('/rooms/presence');
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch room presence');
  return data.presence || {};
}

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

export async function closeRoom(uuid) {
  const res = await request(`/rooms/${uuid}/close`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to close room');
  return data;
}

export async function openRoom(uuid) {
  const res = await request(`/rooms/${uuid}/open`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to open room');
  return data;
}

export async function deleteRoom(uuid) {
  const res = await request(`/rooms/${uuid}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to delete room');
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
