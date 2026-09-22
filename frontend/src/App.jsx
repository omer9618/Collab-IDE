import React, { useState, useEffect } from 'react';
import AuthView from './components/AuthView';
import DashboardView from './components/DashboardView';
import WorkspaceView from './components/WorkspaceView';
import { getProfile, getToken, setToken, refreshSession } from './services/api';

export default function App() {
  const [user, setUser] = useState(null);
  const [roomUuid, setRoomUuid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState(null);

  // Check URL parameters to automatically drop user into room workspace if joined via link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomUuid(roomParam);
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

    const handleApiError = (e) => {
      setGlobalError(e.detail);
      setTimeout(() => setGlobalError(null), 5000);
    };
    window.addEventListener('api-error', handleApiError);

    return () => {
      window.removeEventListener('auth-expired', handleAuthExpired);
      window.removeEventListener('api-error', handleApiError);
    };
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

  const renderContent = () => {
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

    if (!user) {
      return <AuthView onAuthSuccess={handleAuthSuccess} />;
    }

    if (roomUuid) {
      return (
        <WorkspaceView
          user={user}
          roomUuid={roomUuid}
          onBack={handleBackToDashboard}
        />
      );
    }

    return (
      <DashboardView
        user={user}
        onRoomSelect={handleRoomSelect}
        onLogout={handleLogout}
        onUserUpdate={handleUserUpdate}
      />
    );
  };

  return (
    <>
      {globalError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 bg-red-950/90 border border-accent-red text-accent-red text-sm font-medium rounded-md shadow-lg flex items-center gap-2 animate-in slide-in-from-top-4">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {globalError}
        </div>
      )}
      {renderContent()}
    </>
  );
}
