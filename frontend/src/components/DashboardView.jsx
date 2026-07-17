import React, { useState, useEffect } from 'react';
import { createRoom, joinRoom, logoutUser } from '../services/api';

const RANDOM_ADJECTIVES = ['Super', 'Sleek', 'Hyper', 'Delta', 'Quantum', 'Cyber', 'Mega', 'Apex'];
const RANDOM_NOUNS = ['Space', 'Node', 'Grid', 'Core', 'Doc', 'Byte', 'Stack', 'Nexus'];

export default function DashboardView({ user, onRoomSelect, onLogout }) {
  const [roomName, setRoomName] = useState('');
  const [joinUuid, setJoinUuid] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Modals & Panels toggle
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSignoutConfirm, setShowSignoutConfirm] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState('my-rooms'); // my-rooms, joined-rooms

  // Mock list of user rooms
  const [myRooms, setMyRooms] = useState([
    { uuid: 'd12241f2-9f65-422a-858d-f87ca66d4b4a', name: 'web-engine-auth', lang: 'JS', time: '2 hours ago', files: 'main.js, auth.js, +1', peers: ['O', 'H'] },
    { uuid: 'a09f04a9-4ac1-48c5-9f30-6a4ce837fbe6', name: 'api-service-v2', lang: 'PY', time: 'Yesterday', files: 'app.py, routes.py, +3', peers: ['O', 'A'] }
  ]);

  const generateRandomName = () => {
    const adj = RANDOM_ADJECTIVES[Math.floor(Math.random() * RANDOM_ADJECTIVES.length)];
    const noun = RANDOM_NOUNS[Math.floor(Math.random() * RANDOM_NOUNS.length)];
    const num = Math.floor(Math.random() * 900 + 100);
    setRoomName(`${adj}-${noun}-${num}`);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    setError('');
    setLoading(true);
    try {
      const room = await createRoom(roomName.trim());
      onRoomSelect(room.uuid);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    if (!joinUuid.trim()) return;
    setError('');
    setLoading(true);
    try {
      await joinRoom(joinUuid.trim());
      onRoomSelect(joinUuid.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutClick = () => {
    setShowSignoutConfirm(true);
  };

  const handleConfirmLogout = async () => {
    setShowSignoutConfirm(false);
    try {
      await logoutUser();
      onLogout();
    } catch (err) {
      onLogout();
    }
  };

  // Get initials for profile badge
  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n.charAt(0)).join('').toUpperCase().slice(0, 2);
  };

  const userInitials = getInitials(user.displayName);

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary font-ui overflow-hidden">
      {/* Top Bar (44px) */}
      <header className="h-[44px] shrink-0 bg-[#121414] border-b border-[#2b2b2b] flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-2 cursor-pointer">
          <img src="/logo.png" className="w-5 h-5 object-contain rounded-sm" alt="CollabIDE Logo" />
          <span className="font-semibold text-text-base text-accent-blue tracking-tight">CollabIDE</span>
        </div>
        <div className="flex items-center gap-4">
          <div
            className="w-8 h-8 rounded-full bg-accent-blue-dim flex items-center justify-center text-accent-blue font-semibold text-text-sm cursor-pointer"
            onClick={() => setShowSettingsDrawer(true)}
            style={{ backgroundColor: user.avatarColor + '30', color: user.avatarColor }}
          >
            {userInitials}
          </div>
        </div>
      </header>

      {/* Main container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar (48px) */}
        <aside className="w-[48px] bg-[#0d0e0f] border-r border-[#2b2b2b] flex flex-col items-center py-4 shrink-0">
          <div className="flex flex-col gap-4 flex-1">
            <button className="w-10 h-10 flex items-center justify-center border-l-2 border-accent-blue text-accent-blue" title="Explorer">
              <span className="material-symbols-outlined">folder</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center text-outline opacity-40 cursor-not-allowed" disabled title="Participants (Disabled)">
              <span className="material-symbols-outlined">people</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center text-outline opacity-40 cursor-not-allowed" disabled title="Chat (Disabled)">
              <span className="material-symbols-outlined">chat</span>
            </button>
          </div>
          <div className="flex flex-col gap-4">
            <button
              className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              title="Settings"
              onClick={() => setShowSettingsDrawer(true)}
            >
              <span className="material-symbols-outlined">settings</span>
            </button>
            <button
              className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-accent-red"
              title="Sign Out"
              onClick={handleLogoutClick}
            >
              <span className="material-symbols-outlined">logout</span>
            </button>
          </div>
        </aside>

        {/* Sidebar (240px) */}
        <aside className="w-[240px] bg-[#1b1c1c] border-r border-[#2b2b2b] flex flex-col shrink-0">
          {/* Profile Panel */}
          <div className="p-4 border-b border-[#2b2b2b]">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-text-lg relative"
                style={{ backgroundColor: user.avatarColor }}
              >
                {userInitials.charAt(0)}
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-accent-green rounded-full border-2 border-[#1b1c1c]" />
              </div>
              <div className="overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <span className="text-text-sm font-medium text-on-surface truncate">{user.displayName}</span>
                  <span className="px-1.5 py-0.5 bg-[#3d3000] text-[#f9ab00] rounded-sm text-[10px] font-semibold uppercase">Owner</span>
                </div>
                <div className="text-text-xs text-on-surface-variant truncate">{user.email}</div>
              </div>
            </div>
          </div>

          {/* Rooms navigation */}
          <div className="flex-1 py-2">
            <div className="px-4 py-2 text-text-xs font-semibold text-outline tracking-wider uppercase">Rooms</div>
            <nav className="space-y-0.5">
              <button
                className={`w-full flex items-center gap-3 px-4 py-1.5 text-left text-text-sm border-l-2 transition-all ${
                  activeTab === 'my-rooms'
                    ? 'bg-[#292a2a] text-on-surface border-accent-blue'
                    : 'text-on-surface-variant hover:bg-[#252626] border-transparent'
                }`}
                onClick={() => setActiveTab('my-rooms')}
              >
                <span className="material-symbols-outlined text-[18px]">radio_button_checked</span>
                <span>My Rooms</span>
              </button>
              <button
                className={`w-full flex items-center gap-3 px-4 py-1.5 text-left text-text-sm border-l-2 transition-all ${
                  activeTab === 'joined-rooms'
                    ? 'bg-[#292a2a] text-on-surface border-accent-blue'
                    : 'text-on-surface-variant hover:bg-[#252626] border-transparent'
                }`}
                onClick={() => setActiveTab('joined-rooms')}
              >
                <span className="material-symbols-outlined text-[18px]">radio_button_unchecked</span>
                <span>Joined Rooms</span>
              </button>
            </nav>
          </div>

          {/* Create new room button */}
          <div className="p-4 mt-auto">
            <button
              className="w-full py-2 bg-accent-blue text-white rounded-md text-text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              onClick={() => {
                generateRandomName();
                setShowCreateModal(true);
              }}
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Create new room</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 bg-[#121414] overflow-y-auto">
          <div className="p-8 max-w-5xl mx-auto h-full flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-text-xl font-semibold text-on-surface">
                {activeTab === 'my-rooms' ? 'My Rooms' : 'Joined Rooms'}
              </h2>
              <button
                className="px-4 py-2 border border-[#404751] text-on-surface rounded-md text-text-sm font-medium hover:bg-[#252626] transition-colors flex items-center gap-2"
                onClick={() => {
                  generateRandomName();
                  setShowCreateModal(true);
                }}
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>New room</span>
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-950/40 border border-accent-red/30 rounded-radius-md text-accent-red text-xs">
                {error}
              </div>
            )}

            {/* Room List grid */}
            <div className="flex-1 space-y-3">
              {(activeTab === 'my-rooms' ? myRooms : []).map((room) => (
                <div
                  key={room.uuid}
                  className="bg-[#1f2020] border border-[#404751] rounded-lg p-4 flex items-center justify-between hover:border-accent-blue transition-all group cursor-pointer"
                  onClick={() => onRoomSelect(room.uuid)}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-sm flex items-center justify-center font-bold text-text-xs ${
                        room.lang === 'JS'
                          ? 'bg-[#e3e300] text-black'
                          : room.lang === 'PY'
                          ? 'bg-[#007acc] text-white'
                          : 'bg-purple-600 text-white'
                      }`}
                    >
                      {room.lang}
                    </div>
                    <div>
                      <h3 className="text-text-base font-semibold text-on-surface">{room.name}</h3>
                      <div className="flex items-center gap-2 text-text-xs text-on-surface-variant mt-0.5">
                        <span>Owner</span>
                        <span>•</span>
                        <span>{room.time}</span>
                        <span>•</span>
                        <span>{room.files}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex -space-x-2">
                      {room.peers.map((peer, idx) => (
                        <div
                          key={idx}
                          className="w-7 h-7 rounded-full bg-accent-blue border-2 border-[#1f2020] flex items-center justify-center text-[10px] font-bold text-white"
                          style={{ backgroundColor: idx === 1 ? '#1e8e3e' : '#1a73e8' }}
                        >
                          {peer}
                        </div>
                      ))}
                    </div>
                    <button className="px-4 py-1.5 bg-[#292a2a] text-on-surface rounded-md text-text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      Open →
                    </button>
                  </div>
                </div>
              ))}

              {activeTab === 'joined-rooms' && (
                <div className="text-center py-12 border border-dashed border-[#404751] rounded-lg">
                  <span className="material-symbols-outlined text-[48px] text-text-muted mb-2">folder</span>
                  <div className="text-text-base text-on-surface">No joined rooms yet</div>
                  <div className="text-text-xs text-text-muted mt-1">Use a share code to join another user's room.</div>
                </div>
              )}
            </div>

            {/* Quick Join Footer */}
            <div className="mt-12 py-8 border-t border-[#2b2b2b] flex flex-col items-center">
              <div className="text-text-xs text-outline uppercase font-semibold tracking-[0.2em] mb-4">
                or join with a room code
              </div>
              <form onSubmit={handleJoinSubmit} className="flex items-center gap-2 w-full max-w-sm">
                <input
                  className="flex-1 bg-[#1f2020] border border-[#404751] rounded-md px-3 py-2 text-text-sm text-on-surface focus:border-accent-blue focus:ring-0 outline-none transition-colors"
                  placeholder="Enter room code..."
                  type="text"
                  value={joinUuid}
                  onChange={(e) => setJoinUuid(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-accent-blue text-white rounded-md text-text-sm font-semibold hover:opacity-90"
                >
                  Join →
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>

      {/* Status Bar */}
      <footer className="h-status-bar-height bg-accent-blue text-white flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-4 text-[11px] font-medium">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-accent-green" />
            <span>Synced</span>
          </div>
          <div className="w-px h-3 bg-white/20" />
          <span>Active Session</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-medium opacity-95">
          <span>v1.0.0</span>
        </div>
      </footer>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="w-full max-w-[440px] bg-[#1b1c1c] border border-border-default rounded-radius-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-[#2b2b2b] pb-3">
              <h3 className="text-text-base font-semibold text-on-surface">Create a new room</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-text-muted hover:text-text-primary">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-text-secondary text-[13px]">Room Name</label>
                <input
                  className="w-full h-[36px] px-3 bg-[#121414] border border-[#404751] rounded-radius-md text-text-primary text-[14px] placeholder-text-muted focus:border-accent-blue outline-none"
                  type="text"
                  required
                  placeholder="my-project-room"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
                <button
                  type="button"
                  className="text-accent-blue text-[11px] hover:underline flex items-center gap-1 mt-1"
                  onClick={generateRandomName}
                >
                  <span className="material-symbols-outlined text-[12px]">refresh</span> Random Name
                </button>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#2b2b2b]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-1.5 border border-[#404751] text-on-surface rounded-md text-text-sm hover:bg-[#252626]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-1.5 bg-accent-blue text-white rounded-md text-text-sm hover:opacity-90"
                >
                  {loading ? 'Creating...' : 'Create room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sign Out Confirmation Modal */}
      {showSignoutConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="w-full max-w-[400px] bg-[#1b1c1c] border border-border-default rounded-radius-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-[#2b2b2b] pb-3">
              <h3 className="text-text-base font-semibold text-on-surface">Confirm Sign Out</h3>
              <button onClick={() => setShowSignoutConfirm(false)} className="text-text-muted hover:text-text-primary">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <p className="text-text-secondary text-text-sm leading-relaxed">
              Are you sure you want to sign out of CollabIDE? You will need to enter your email and password to log in again.
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#2b2b2b]">
              <button
                type="button"
                onClick={() => setShowSignoutConfirm(false)}
                className="px-4 py-1.5 border border-[#404751] text-on-surface rounded-md text-text-sm hover:bg-[#252626]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                className="px-4 py-1.5 bg-accent-red text-white rounded-md text-text-sm hover:opacity-90 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Drawer (Right Side Drawer) */}
      {showSettingsDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettingsDrawer(false)} />
          <div className="relative w-[320px] h-full bg-[#1b1c1c] border-l border-[#2b2b2b] shadow-2xl flex flex-col p-6 space-y-6">
            <div className="flex justify-between items-center border-b border-[#2b2b2b] pb-3">
              <h3 className="text-text-base font-semibold text-on-surface">Settings</h3>
              <button onClick={() => setShowSettingsDrawer(false)} className="text-text-muted hover:text-text-primary">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto no-scrollbar">
              {/* Profile details */}
              <div className="space-y-3">
                <div className="text-text-xs font-semibold text-outline tracking-wider uppercase">Account</div>
                <div className="space-y-1">
                  <div className="text-[11px] text-text-muted">Display Name</div>
                  <div className="text-text-sm text-text-primary bg-[#121414] px-3 py-2 rounded border border-[#2b2b2b]">
                    {user.displayName}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] text-text-muted">Email Address</div>
                  <div className="text-text-sm text-text-muted bg-[#121414]/50 px-3 py-2 rounded border border-[#2b2b2b]/50">
                    {user.email}
                  </div>
                </div>
              </div>

              {/* Preferences */}
              <div className="space-y-3">
                <div className="text-text-xs font-semibold text-outline tracking-wider uppercase">Appearance</div>
                <div className="flex justify-between items-center text-text-sm">
                  <span>Theme</span>
                  <div className="flex gap-1 bg-[#121414] p-0.5 rounded border border-[#2b2b2b]">
                    <button className="px-2 py-0.5 bg-[#292a2a] text-accent-blue rounded text-xs">Dark</button>
                    <button className="px-2 py-0.5 text-text-muted rounded text-xs cursor-not-allowed" disabled>Light</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-[#2b2b2b] pt-4">
              <button
                className="w-full py-2 bg-red-950/20 border border-accent-red/30 hover:bg-red-950/40 text-accent-red rounded text-text-sm font-medium transition-colors"
                onClick={handleLogoutClick}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
