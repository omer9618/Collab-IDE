import React, { useState, useEffect } from 'react';
import {
  updateProfile, requestEmailChange, cancelEmailChange,
  getSessions, revokeSession, revokeAllOtherSessions
} from '../services/api';

const CURATED_COLORS = [
  { hex: '#1a73e8', name: 'Collab Blue' },
  { hex: '#007acc', name: 'Editor Blue' },
  { hex: '#1e8e3e', name: 'Emerald' },
  { hex: '#f9ab00', name: 'Amber Gold' },
  { hex: '#a142f4', name: 'Purple' },
  { hex: '#e52592', name: 'Vibrant Pink' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#ea580c', name: 'Orange' },
];

const getRelativeTime = (dateStr) => {
  if (!dateStr) return 'Recently';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
};

export default function ProfileDrawer({
  isOpen,
  onClose,
  user,
  allRooms = [],
  onUserUpdate,
  onRoomSelect,
  onLogoutClick,
  onLogoutAllClick,
}) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const [colorSaving, setColorSaving] = useState(false);
  const [colorSuccess, setColorSuccess] = useState(false);

  // Email change state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccessMsg, setEmailSuccessMsg] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);

  // Rooms tab: 'owned' | 'joined'
  const [roomsTab, setRoomsTab] = useState('owned');

  // Active Sessions
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [viewAllSessions, setViewAllSessions] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
    }
  }, [user]);

  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen]);

  const loadSessions = async () => {
    try {
      setLoadingSessions(true);
      const data = await getSessions();
      setSessions(data || []);
    } catch (error) {
      console.error('Failed to load sessions', error);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleRevoke = async (id) => {
    try {
      setRevokingId(id);
      await revokeSession(id);
      setSessions(prev => prev.filter(s => s._id !== id));
    } catch (err) {
      console.error('Failed to revoke session:', err);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAllOther = async () => {
    try {
      setRevokingId('ALL_OTHER');
      await revokeAllOtherSessions();
      setSessions(prev => prev.filter(s => s.isCurrent));
    } catch (err) {
      console.error('Failed to revoke all other sessions:', err);
    } finally {
      setRevokingId(null);
    }
  };

  if (!isOpen || !user) return null;

  const initials = (user.displayName || 'U')
    .split(' ')
    .map((n) => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const ownedRooms = allRooms.filter((r) => r.myRole === 'Owner');
  const joinedRooms = allRooms.filter((r) => r.myRole !== 'Owner');

  // Handle Display Name Save
  const handleSaveDisplayName = async (e) => {
    if (e) e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError('Display name cannot be empty');
      return;
    }
    if (trimmed.length > 50) {
      setNameError('Display name must be 50 characters or less');
      return;
    }
    if (trimmed === user.displayName) {
      setIsEditingName(false);
      setNameError('');
      return;
    }

    try {
      setNameSaving(true);
      setNameError('');
      const updated = await updateProfile({ displayName: trimmed });
      onUserUpdate?.(updated);
      setIsEditingName(false);
    } catch (err) {
      setNameError(err.message || 'Failed to update display name');
    } finally {
      setNameSaving(false);
    }
  };

  // Handle Avatar Color Change
  const handleSelectColor = async (hex) => {
    if (hex === user.avatarColor || colorSaving) return;
    try {
      setColorSaving(true);
      const updated = await updateProfile({ avatarColor: hex });
      onUserUpdate?.(updated);
      setColorSuccess(true);
      setTimeout(() => setColorSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to update avatar color:', err);
    } finally {
      setColorSaving(false);
    }
  };

  // Handle Email Change Request
  const handleRequestEmailChange = async (e) => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) {
      setEmailError('Please enter a new email address');
      return;
    }
    if (trimmed === user.email.toLowerCase()) {
      setEmailError('New email must be different from current email');
      return;
    }

    try {
      setEmailLoading(true);
      setEmailError('');
      setEmailSuccessMsg('');
      const res = await requestEmailChange(trimmed);
      setEmailSuccessMsg(res.message || 'Verification link sent to new email.');
      onUserUpdate?.({ ...user, pendingEmail: trimmed });
      setNewEmail('');
      setShowEmailForm(false);
    } catch (err) {
      setEmailError(err.message || 'Failed to request email change');
    } finally {
      setEmailLoading(false);
    }
  };

  // Handle Cancel Email Change
  const handleCancelEmailChange = async () => {
    try {
      setCancelLoading(true);
      setEmailError('');
      const updated = await cancelEmailChange();
      onUserUpdate?.(updated);
      setEmailSuccessMsg('Pending email change was cancelled.');
      setTimeout(() => setEmailSuccessMsg(''), 4000);
    } catch (err) {
      setEmailError(err.message || 'Failed to cancel email change');
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Slide-out Panel */}
      <div className="relative w-full max-w-[420px] h-full bg-[#1b1c1c] border-l border-[#2b2b2b] shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-300 ease-out">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2b2b2b] bg-[#121414]/60">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-accent-blue text-xl">account_circle</span>
            <h2 className="text-base font-semibold text-text-primary">Profile & Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[#252626] transition-colors"
            title="Close (Esc)"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-text-primary text-sm">
          {/* Section 1: Live Avatar & Identity Card */}
          <div className="p-4 rounded-xl bg-[#121414] border border-[#2b2b2b] relative overflow-hidden">
            <div className="flex items-center gap-4">
              {/* Dynamic glowing avatar */}
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg relative shrink-0 shadow-lg transition-all duration-200"
                style={{
                  backgroundColor: user.avatarColor,
                  boxShadow: `0 0 16px ${user.avatarColor}40`,
                }}
              >
                {initials}
                <div
                  className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-accent-green rounded-full border-2 border-[#121414]"
                  title="Online"
                />
              </div>

              {/* Identity summary */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-text-primary truncate">
                    {user.displayName}
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-green bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                    Verified
                  </span>
                </div>
                <p className="text-xs text-text-muted truncate mt-0.5">{user.email}</p>
              </div>
            </div>
          </div>

          {/* Section 2: Display Name */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Display Name
              </label>
              {!isEditingName && (
                <button
                  onClick={() => setIsEditingName(true)}
                  className="text-xs text-accent-blue hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">edit</span>
                  Edit
                </button>
              )}
            </div>

            {isEditingName ? (
              <form onSubmit={handleSaveDisplayName} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter display name"
                    autoFocus
                    maxLength={50}
                    className="flex-1 px-3 py-1.5 bg-[#121414] border border-[#404751] focus:border-accent-blue rounded text-sm text-text-primary outline-none transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={nameSaving}
                    className="px-3 py-1.5 bg-accent-blue hover:bg-accent-blue/90 text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {nameSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingName(false);
                      setDisplayName(user.displayName);
                      setNameError('');
                    }}
                    className="px-2.5 py-1.5 bg-[#252626] hover:bg-[#292a2a] text-text-muted rounded text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {nameError && <p className="text-xs text-accent-red">{nameError}</p>}
                <p className="text-[11px] text-text-muted">
                  Visible to collaborators in Monaco editor cursors, live chat, and room headers.
                </p>
              </form>
            ) : (
              <div className="px-3 py-2 bg-[#121414] border border-[#2b2b2b] rounded text-text-primary text-sm">
                {user.displayName}
              </div>
            )}
          </div>

          {/* Section 3: Avatar & Cursor Color Palette (Curated Swatches) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Multiplayer Cursor & Avatar Color
              </label>
              {colorSuccess && (
                <span className="text-[11px] text-accent-green font-medium animate-fade-in">
                  Updated!
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-muted">
              Select your multiplayer color used for your real-time editor cursor and presence badge.
            </p>

            <div className="grid grid-cols-4 gap-2.5 pt-1">
              {CURATED_COLORS.map((color) => {
                const isSelected = user.avatarColor?.toLowerCase() === color.hex.toLowerCase();
                return (
                  <button
                    key={color.hex}
                    type="button"
                    title={color.name}
                    disabled={colorSaving}
                    onClick={() => handleSelectColor(color.hex)}
                    className={`group flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${isSelected
                        ? 'bg-[#252626] border-accent-blue shadow-md'
                        : 'bg-[#121414] border-[#2b2b2b] hover:border-[#404751] hover:bg-[#1f2020]'
                      }`}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm"
                      style={{ backgroundColor: color.hex }}
                    >
                      {isSelected && (
                        <span className="material-symbols-outlined text-white text-xs font-bold">
                          check
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted truncate w-full text-center group-hover:text-text-primary">
                      {color.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 4: Email Address & Re-verification */}
          <div className="space-y-3 pt-2 border-t border-[#2b2b2b]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Email Address
              </label>
              {!showEmailForm && !user.pendingEmail && (
                <button
                  onClick={() => {
                    setShowEmailForm(true);
                    setEmailError('');
                    setEmailSuccessMsg('');
                  }}
                  className="text-xs text-accent-blue hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">sync_alt</span>
                  Change Email
                </button>
              )}
            </div>

            {/* Current email pill */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#121414] border border-[#2b2b2b] rounded">
              <span className="text-text-primary text-sm font-mono truncate">{user.email}</span>
              <span className="text-[11px] text-accent-green bg-emerald-950/30 px-2 py-0.5 rounded border border-emerald-800/30 shrink-0">
                Active
              </span>
            </div>

            {/* Pending verification alert banner */}
            {user.pendingEmail && (
              <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-lg space-y-2">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-400 text-sm mt-0.5 shrink-0">
                    mail
                  </span>
                  <div className="text-xs text-amber-200/90 leading-relaxed">
                    Verification link sent to{' '}
                    <strong className="text-amber-100 font-mono">{user.pendingEmail}</strong>.
                    Your current email remains active until confirmed.
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-[11px] text-amber-400/80">Pending verification</span>
                  <button
                    type="button"
                    disabled={cancelLoading}
                    onClick={handleCancelEmailChange}
                    className="text-accent-red hover:underline text-xs font-medium disabled:opacity-50"
                  >
                    {cancelLoading ? 'Cancelling...' : 'Cancel Request'}
                  </button>
                </div>
              </div>
            )}

            {/* Change Email Form */}
            {showEmailForm && (
              <form onSubmit={handleRequestEmailChange} className="p-3 bg-[#121414] border border-[#404751] rounded-lg space-y-2.5">
                <div className="text-xs font-medium text-text-primary">Request Email Change</div>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Enter new email address"
                  className="w-full px-3 py-1.5 bg-[#1b1c1c] border border-[#404751] focus:border-accent-blue rounded text-sm text-text-primary outline-none transition-colors"
                />
                <p className="text-[11px] text-text-muted leading-tight">
                  Per security requirements (FR-08), you will be sent a time-limited confirmation link before the change is finalized.
                </p>

                {emailError && <p className="text-xs text-accent-red">{emailError}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailForm(false);
                      setNewEmail('');
                      setEmailError('');
                    }}
                    className="px-3 py-1 text-xs text-text-muted hover:text-text-primary bg-[#252626] rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={emailLoading}
                    className="px-3 py-1 text-xs font-medium text-white bg-accent-blue hover:bg-accent-blue/90 rounded disabled:opacity-50"
                  >
                    {emailLoading ? 'Sending...' : 'Send Verification'}
                  </button>
                </div>
              </form>
            )}

            {emailSuccessMsg && (
              <div className="p-2.5 bg-emerald-950/20 border border-emerald-800/40 rounded text-xs text-emerald-300">
                {emailSuccessMsg}
              </div>
            )}
          </div>

          {/* Section 5: My Rooms & Roles (FR-08) */}
          <div className="space-y-3 pt-2 border-t border-[#2b2b2b]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                My Rooms & Roles
              </label>
              <span className="text-xs text-text-muted font-mono">{allRooms.length} total</span>
            </div>

            {/* Segmented Tab */}
            <div className="flex bg-[#121414] p-0.5 rounded-lg border border-[#2b2b2b]">
              <button
                type="button"
                onClick={() => setRoomsTab('owned')}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${roomsTab === 'owned'
                    ? 'bg-[#252626] text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                  }`}
              >
                Owned ({ownedRooms.length})
              </button>
              <button
                type="button"
                onClick={() => setRoomsTab('joined')}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${roomsTab === 'joined'
                    ? 'bg-[#252626] text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                  }`}
              >
                Joined ({joinedRooms.length})
              </button>
            </div>

            {/* Room List */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
              {(roomsTab === 'owned' ? ownedRooms : joinedRooms).length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted border border-dashed border-[#2b2b2b] rounded-lg">
                  {roomsTab === 'owned' ? 'No rooms created yet.' : 'No joined rooms found.'}
                </div>
              ) : (
                (roomsTab === 'owned' ? ownedRooms : joinedRooms).map((room) => {
                  const role = room.myRole || (room.owner?._id === user.id ? 'Owner' : 'Viewer');
                  return (
                    <div
                      key={room.uuid || room.id}
                      className="p-2.5 rounded-lg bg-[#121414] border border-[#2b2b2b] hover:border-[#404751] transition-all flex items-center justify-between gap-2 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-xs text-text-primary truncate">
                            {room.name}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-medium shrink-0 border ${role === 'Owner'
                                ? 'bg-purple-950/40 text-purple-300 border-purple-800/40'
                                : role === 'Room Leader'
                                  ? 'bg-amber-950/40 text-amber-300 border-amber-800/40'
                                  : role === 'Editor'
                                    ? 'bg-blue-950/40 text-blue-300 border-blue-800/40'
                                    : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/40'
                              }`}
                          >
                            {role}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-text-muted mt-1">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">group</span>
                            {room.participantCount || 1}
                          </span>
                          <span>{getRelativeTime(room.updatedAt)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          onRoomSelect?.(room.uuid);
                          onClose();
                        }}
                        className="px-2.5 py-1 bg-[#252626] hover:bg-accent-blue hover:text-white text-text-muted rounded text-xs font-medium transition-colors shrink-0 flex items-center gap-1"
                        title="Enter room"
                      >
                        <span>Open</span>
                        <span className="material-symbols-outlined text-xs">arrow_forward</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Section 6: Active Sessions (FR-07) */}
          <div className="space-y-3 pt-2 border-t border-[#2b2b2b]">
            <div className="flex justify-between items-end mb-2">
              <div>
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Active Sessions</h3>
                <p className="text-[10px] text-text-muted mt-0.5">Manage the devices logged into your account.</p>
              </div>
              <button
                type="button"
                onClick={handleRevokeAllOther}
                disabled={revokingId === 'ALL_OTHER' || sessions.length <= 1}
                className="px-2 py-1 bg-red-950/20 border border-accent-red/30 hover:bg-red-950/40 text-accent-red rounded text-[10px] font-medium transition-colors disabled:opacity-50"
              >
                {revokingId === 'ALL_OTHER' ? 'Revoking...' : 'Revoke All Other'}
              </button>
            </div>

            <div className={`space-y-2 ${viewAllSessions ? 'max-h-[160px] overflow-y-auto custom-scrollbar pr-1' : ''}`}>
              {loadingSessions ? (
                <div className="py-4 text-center text-xs text-text-muted">Loading sessions...</div>
              ) : (
                (viewAllSessions ? sessions : sessions.slice(0, 3)).map(session => (
                  <div key={session._id} className="p-2.5 rounded-lg bg-[#121414] border border-[#2b2b2b] flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs text-text-primary truncate">
                          {session.deviceInfo}
                        </span>
                        {session.isCurrent && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950/40 text-accent-green border border-emerald-800/40 rounded uppercase font-bold tracking-wide">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-text-muted mt-1">
                        <span>{getRelativeTime(session.lastActive)}</span>
                      </div>
                    </div>
                    {!session.isCurrent && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(session._id)}
                        disabled={revokingId === session._id}
                        className="p-1.5 text-text-muted hover:text-accent-red rounded transition-colors disabled:opacity-50"
                        title="Revoke Session"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {revokingId === session._id ? 'hourglass_empty' : 'close'}
                        </span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            
            {!loadingSessions && !viewAllSessions && sessions.length > 3 && (
              <button
                type="button"
                onClick={() => setViewAllSessions(true)}
                className="w-full py-2 mt-2 text-xs font-medium text-accent-blue hover:text-white bg-[#1b1c1c] hover:bg-accent-blue border border-[#2b2b2b] hover:border-accent-blue rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <span>View All ({sessions.length})</span>
                <span className="material-symbols-outlined text-sm">expand_more</span>
              </button>
            )}
            {!loadingSessions && viewAllSessions && sessions.length > 3 && (
              <button
                type="button"
                onClick={() => setViewAllSessions(false)}
                className="w-full py-1.5 mt-2 text-xs font-medium text-text-muted hover:text-text-primary bg-transparent rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <span>Show Less</span>
                <span className="material-symbols-outlined text-sm">expand_less</span>
              </button>
            )}
          </div>
        </div>

        {/* Pinned Bottom Actions */}
        <div className="p-4 border-t border-[#2b2b2b] bg-[#121414]/80 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onLogoutAllClick?.();
            }}
            className="w-full py-2 bg-red-950/20 border border-accent-red/30 hover:bg-red-950/40 text-accent-red rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">phonelink_erase</span>
            Sign Out of All Devices
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onLogoutClick?.();
            }}
            className="w-full py-2 bg-transparent border border-accent-red/20 hover:border-accent-red/50 text-accent-red/80 hover:text-accent-red rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
