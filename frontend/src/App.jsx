import React, { useState, useEffect } from 'react';
import AuthView from './components/AuthView';
import DashboardView from './components/DashboardView';
import WorkspaceView from './components/WorkspaceView';
import { getProfile, getToken, setToken, refreshSession } from './services/api';

export default function App() {
  const [user, setUser] = useState(null);
  const [roomUuid, setRoomUuid] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check URL parameters to automatically drop user into room workspace or reset password
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomUuid(roomParam);
    }

    const resetParam = params.get('resetToken') || params.get('token');
    if (resetParam) {
      setResetToken(resetParam);
    }

    async function checkAuth() {
      try {
        let token = getToken();
        if (!token) {
          // Attempt to bootstrap from HttpOnly cookie
          token = await refreshSession();
        }

        if (token) {
          const profile = await getProfile();
          setUser(profile);
        }
      } catch (e) {
        // Token expired or invalid
        setToken(null);
      } finally {
        setLoading(false);
      }
    }
    checkAuth();

    // Listen for refresh expiration events (NFR-13)
    const handleAuthExpired = () => {
      setUser(null);
      setRoomUuid(null);
    };
    window.addEventListener('auth-expired', handleAuthExpired);
    return () => window.removeEventListener('auth-expired', handleAuthExpired);
  }, []);

  const handleAuthSuccess = (authenticatedUser) => {
    setUser(authenticatedUser);
  };

  const handleRoomSelect = (uuid) => {
    setRoomUuid(uuid);
    // Sync room ID to URL parameters so page refreshes persist the room workspace session
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${uuid}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  };

  const handleBackToDashboard = () => {
    setRoomUuid(null);
    // Clear URL parameters
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.pushState({ path: cleanUrl }, '', cleanUrl);
  };

  const handleUserUpdate = (updatedUser) => {
    setUser((prev) => (prev ? { ...prev, ...updatedUser } : updatedUser));
  };

  const handleLogout = () => {
    setUser(null);
    setRoomUuid(null);
    handleBackToDashboard();
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'var(--bg)',
          color: 'var(--text)',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: '500' }}>Loading CollabIDE Workspace...</div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <AuthView
        onAuthSuccess={handleAuthSuccess}
        initialResetToken={resetToken}
        onClearResetToken={() => {
          setResetToken(null);
          const cleanUrl = `${window.location.origin}${window.location.pathname}`;
          window.history.replaceState({}, '', cleanUrl);
        }}
      />
    );
  }

  // Inside Room Workspace
  if (roomUuid) {
    return (
      <WorkspaceView
        key={roomUuid}
        roomUuid={roomUuid}
        user={user}
        onBack={handleBackToDashboard}
        onRoomSelect={handleRoomSelect}
      />
    );
  }

  // Dashboard
  return (
    <DashboardView
      user={user}
      onRoomSelect={handleRoomSelect}
      onLogout={handleLogout}
      onUserUpdate={handleUserUpdate}
    />
  );
}
