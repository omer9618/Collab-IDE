/**
 * @fileoverview Main Application Root Component (App.jsx).
 *
 * Coordinates top-level authentication bootstrapping, session refresh listeners (NFR-13),
 * global route state (AuthView, DashboardView, WorkspaceView), URL parameter deep-linking,
 * global error notifications, and document theme synchronization (FR-24).
 *
 * @module App
 */

import React, { useState, useEffect } from 'react';
import AuthView from './components/AuthView';
import DashboardView from './components/DashboardView';
import WorkspaceView from './components/WorkspaceView';
import { getProfile, getToken, setToken, refreshSession } from './services/api';

/**
 * Root React component for CollabIDE.
 *
 * Manages user authentication lifecycle, view transitions between login,
 * dashboard, and workspace views, and document-level theme classes.
 *
 * @returns {React.ReactElement} The active view hierarchy.
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [roomUuid, setRoomUuid] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState(null);

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

  // Synchronize document theme class for full web UI theming (FR-24)
  useEffect(() => {
    // Prioritize localStorage to remember choices across refresh and logout
    let activeTheme = localStorage.getItem('collabide_theme');
    if (!activeTheme) {
      activeTheme = user?.theme || 'vs-dark';
      localStorage.setItem('collabide_theme', activeTheme);
    }

    const isLight = activeTheme === 'light';
    if (isLight) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    // Sync choice to backend if logged in and differs
    if (user && user.theme !== activeTheme) {
      import('./services/api').then(({ updateProfile }) => {
        updateProfile({ theme: activeTheme }).catch(console.error);
      });
    }
  }, [user?.theme]);

  /**
   * Sets authenticated user in root state upon successful login or registration.
   *
   * @param {Object} authenticatedUser - Authenticated user profile.
   */
  const handleAuthSuccess = (authenticatedUser) => {
    setUser(authenticatedUser);
  };

  /**
   * Navigates the application into the specified room workspace.
   * Synchronizes URL query parameters to support link sharing and page reloads.
   *
   * @param {string} uuid - Room UUID identifier.
   */
  const handleRoomSelect = (uuid) => {
    setRoomUuid(uuid);
    // Sync room ID to URL parameters so page refreshes persist the room workspace session
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${uuid}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  };

  /**
   * Navigates back from a room workspace to the main dashboard and clears URL params.
   */
  const handleBackToDashboard = () => {
    setRoomUuid(null);
    // Clear URL parameters
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.pushState({ path: cleanUrl }, '', cleanUrl);
  };

  /**
   * Merges partial profile updates into active user state.
   *
   * @param {Object} updatedUser - Updated user properties.
   */
  const handleUserUpdate = (updatedUser) => {
    setUser((prev) => (prev ? { ...prev, ...updatedUser } : updatedUser));
  };

  /**
   * Clears user session and navigates to the login screen.
   */
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

    if (roomUuid) {
      return (
        <WorkspaceView
          user={user}
          roomUuid={roomUuid}
          onBack={handleBackToDashboard}
          onUserUpdate={handleUserUpdate}
          onRoomSelect={handleRoomSelect}
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
