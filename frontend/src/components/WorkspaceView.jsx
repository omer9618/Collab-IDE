import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { io } from 'socket.io-client';
import {
  getRoomDetails,
  getVoiceCredentials,
  runCode as apiRunCode,
  getExecutionHistory,
  joinRoom,
  getToken,
  promoteMember,
  getProfile,
} from '../services/api';
import {
  Folder,
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Play,
  VolumeX,
  Lock,
  Unlock,
  Volume2,
  Mic,
  MicOff,
  PhoneOff,
  MoreHorizontal,
  ChevronDown,
  FileCode,
  Share2,
} from 'lucide-react';

const DEFAULT_CODE = {
  'main.js': `// CollabIDE — Real-time collaborative editor
function greet(name) {
  return \`Hello, \${name}! Welcome to CollabIDE.\`;
}
console.log(greet("World"));`,
  'utils.js': `// utils.js — shared utilities
function formatDate(date) {
  return new Intl.DateTimeFormat('en-GB').format(date);
}
module.exports = { formatDate };`,
  'README.md': `# CollabIDE Room\nCollaborate and execute code live!`,
};

export default function WorkspaceView({ roomUuid, user, onBack }) {
  const [room, setRoom] = useState(null);
  const [role, setRole] = useState('Viewer');
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState('main.js');
  const [isSyncing, setIsSyncing] = useState(true);
  const [syncStatus, setSyncStatus] = useState('Connecting…');
  const [onlineCount, setOnlineCount] = useState(0);

  // Panels visibility
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState('participants'); // participants, chat
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [consoleTab, setConsoleTab] = useState('output'); // output, terminal, problems

  // Code run/output
  const [outputLines, setOutputLines] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Voice channel states
  const [inVoice, setInVoice] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [voiceParticipants, setVoiceParticipants] = useState([]);
  const [editorOnlyMode, setEditorOnlyMode] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [mutedByLeaderMsg, setMutedByLeaderMsg] = useState('');
  const [activeSpeakerSocketId, setActiveSpeakerSocketId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeWorkspaceUsers, setActiveWorkspaceUsers] = useState([]);

  // Refs for Yjs and peer connections
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const [ydoc, setYdoc] = useState(null);
  const [provider, setProvider] = useState(null);
  const monacoBindingRef = useRef(null);
  const voiceSocketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // socketId -> RTCPeerConnection
  const audioElementsRef = useRef(new Map()); // socketId -> HTMLAudioElement

  // REST details refresh
  useEffect(() => {
    setIsAuthReady(false);
    async function loadDetails() {
      try {
        let details;
        try {
          details = await getRoomDetails(roomUuid);
        } catch (err) {
          if (err.message.includes('Access denied') || err.message.includes('not a member')) {
            // Attempt to join first (self-healing for direct link workspace entries)
            await joinRoom(roomUuid);
            details = await getRoomDetails(roomUuid);
          } else {
            throw err;
          }
        }
        setRoom(details.room);
        setRole(details.myRole);
        setFiles(details.room.files || []);

        // Preload execution log history
        const history = await getExecutionHistory(roomUuid);
        if (history && history.length > 0) {
          const lines = [];
          history.forEach((h) => {
            lines.push({ text: `[${h.language}] Run triggered by ${h.triggeredBy}`, type: 'info' });
            if (h.stdout) lines.push({ text: h.stdout, type: 'success' });
            if (h.stderr) lines.push({ text: h.stderr, type: 'err' });
            lines.push({ text: `Status: ${h.status} | Time: ${h.time || '?'}s | Memory: ${h.memory || '?'} KB`, type: 'info' });
            lines.push({ text: '----------------------------------------', type: 'info' });
          });
          setOutputLines(lines);
        }
        setIsAuthReady(true);
      } catch (err) {
        console.error('Failed to load room details:', err.message);
      }
    }
    loadDetails();
  }, [roomUuid]);

  // Connect Yjs WebSocket Sync
  useEffect(() => {
    if (!isAuthReady) return;
    const yDocInstance = new Y.Doc();
    setYdoc(yDocInstance);

    // Connect directly to backend for WebSocket (Vite proxy can drop WS upgrades)
    const wsUrl = window.location.hostname === 'localhost'
      ? 'ws://localhost:3000'
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

    const providerInstance = new WebsocketProvider(wsUrl, roomUuid, yDocInstance, {
      params: { token: getToken() },
    });
    setProvider(providerInstance);



    providerInstance.on('status', ({ status }) => {
      if (status === 'connecting') {
        // Proactively trigger profile call to let api.js automatically rotate token if expired
        getProfile().catch(() => {});

        // Update Yjs parameters with the latest token dynamically (y-websocket regenerates URL using getter)
        providerInstance.params = {
          ...providerInstance.params,
          token: getToken()
        };
      }

      setIsSyncing(status !== 'connected');
      setSyncStatus(status === 'connected' ? 'Synced' : 'Connecting…');
      if (status === 'connected' && providerInstance.ws) {
        providerInstance.ws.addEventListener('message', (event) => {
          try {
            if (typeof event.data === 'string') {
              const data = JSON.parse(event.data);
              if (data.type === 'role_update') {
                console.log('[WS] Received role_update:', data.role);
                setRole(data.role);
              }
            }
          } catch (e) {
            // ignore
          }
        });
      }
    });

    providerInstance.awareness.on('change', () => {
      const states = providerInstance.awareness.getStates();
      setOnlineCount(states.size);

      const usersMap = new Map();
      states.forEach((state) => {
        if (state.user && state.user.id) {
          usersMap.set(state.user.id, state.user);
        }
      });
      setActiveWorkspaceUsers(Array.from(usersMap.values()));
    });

    const ychat = yDocInstance.getArray(`${roomUuid}:chat`);
    ychat.observe(() => {
      setChatMessages(ychat.toArray());
      const box = document.getElementById('chat-msg-container');
      if (box) box.scrollTop = box.scrollHeight;
    });

    return () => {
      if (monacoBindingRef.current) {
        monacoBindingRef.current.destroy();
        monacoBindingRef.current = null;
      }
      providerInstance.destroy();
      yDocInstance.destroy();
      setYdoc(null);
      setProvider(null);
    };
  }, [roomUuid, user, isAuthReady]);

  // Update Yjs awareness user info and role dynamically without reconnecting WebSocket
  useEffect(() => {
    if (provider && role) {
      provider.awareness.setLocalStateField('user', {
        name: user.displayName,
        color: user.avatarColor,
        id: user.id || user._id,
        role: role,
      });
    }
  }, [provider, role, user]);

  // Cleanup Monaco models on unmount to prevent state-reuse conflicts when re-joining room
  useEffect(() => {
    return () => {
      if (monacoRef.current) {
        const models = monacoRef.current.editor.getModels();
        if (models) {
          models.forEach((model) => model.dispose());
        }
      }
    };
  }, []);

  // Monaco Editor Binding
  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    bindEditorModel(activeFile);
  };

  const bindEditorModel = (fileName) => {
    if (!editorRef.current || !ydoc || !provider) return;

    const ytext = ydoc.getText(`${roomUuid}:${fileName}`);

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;
    model.setEOL(0); // Enforce LF line endings (0) to prevent cursor offset misalignment between CRLF and LF clients

    import('y-monaco').then(({ MonacoBinding }) => {
      if (monacoBindingRef.current) monacoBindingRef.current.destroy();
      monacoBindingRef.current = new MonacoBinding(
        ytext,
        model,
        new Set([editor]),
        provider.awareness
      );
    });
  };

  useEffect(() => {
    if (editorRef.current && ydoc && provider) {
      bindEditorModel(activeFile);
    }
  }, [activeFile, ydoc, provider]);

  // Run code handler
  const handleRunCode = async () => {
    if (!editorRef.current || isRunning) return;
    setIsRunning(true);
    setConsoleOpen(true);
    setConsoleTab('output');
    setOutputLines((prev) => [...prev, { text: `> Running ${activeFile}...`, type: 'info' }]);

    try {
      const code = editorRef.current.getValue();
      const language = activeFile.endsWith('.js')
        ? 'javascript'
        : activeFile.endsWith('.py')
        ? 'python'
        : 'javascript';

      const result = await apiRunCode(roomUuid, { code, language });

      const newLines = [];
      if (result.stdout) newLines.push({ text: result.stdout, type: 'success' });
      if (result.stderr) newLines.push({ text: result.stderr, type: 'err' });
      newLines.push({
        text: `Status: ${result.status} | Time: ${result.time || '?'}s | Memory: ${result.memory || '?'} KB`,
        type: 'info',
      });
      newLines.push({ text: '----------------------------------------', type: 'info' });

      setOutputLines((prev) => [...prev, ...newLines]);
    } catch (err) {
      setOutputLines((prev) => [...prev, { text: `Error: ${err.message}`, type: 'err' }]);
    } finally {
      setIsRunning(false);
    }
  };

  // Copy console output to clipboard
  const handleCopyOutput = () => {
    const textToCopy = outputLines.map(line => line.text).join('\n');
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
    }
  };

  // Clear console output
  const handleClearOutput = () => {
    setOutputLines([]);
  };

  // Chat message sender
  const handleSendChat = () => {
    if (!chatInput.trim() || !ydoc) return;
    const ychat = ydoc.getArray(`${roomUuid}:chat`);
    ychat.push([
      {
        userId: user.id || user._id,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        text: chatInput.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setChatInput('');
  };

  // ─── WebRTC VOICE SIGNALLING ────────────────────────────────────────────────

  const joinVoice = async () => {
    if (inVoice) return;
    setMutedByLeaderMsg('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);

      // This REST call auto-refreshes the JWT if expired (via request() in api.js)
      const credsData = await getVoiceCredentials(roomUuid);

      // Read the (possibly refreshed) token AFTER the API call
      const freshToken = getToken();
      console.log('[Voice] Token available:', !!freshToken, 'length:', freshToken?.length);

      // Connect directly to backend to bypass Vite proxy WebSocket issues
      const backendUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3000'
        : window.location.origin;

      const socket = io(backendUrl + '/voice', {
        auth: { token: freshToken },
        transports: ['websocket'],
        forceNew: true,
        timeout: 10000,
        reconnection: false,
      });
      voiceSocketRef.current = socket;

      socket.on('connect', () => {
        console.log('[Voice] Connected successfully, socket id:', socket.id);
        socket.emit('voice:join', { roomUuid });
        setInVoice(true);
      });

      socket.on('connect_error', (err) => {
        console.error('[Voice] Connection error:', err.message, err);
        leaveVoice();
      });

      socket.on('voice:participant-joined', async ({ joined, participants }) => {
        setVoiceParticipants(participants);
        if (joined.socketId !== socket.id) {
          const pc = createPeerConnection(joined.socketId, stream, credsData.iceServers);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('voice:offer', { to: joined.socketId, sdp: offer });
        }
      });

      socket.on('voice:participant-left', ({ socketId, participants }) => {
        setVoiceParticipants(participants);
        closePeerConnection(socketId);
      });

      socket.on('voice:offer', async ({ from, sdp }) => {
        const pc = createPeerConnection(from, stream, credsData.iceServers);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice:answer', { to: from, sdp: answer });
      });

      socket.on('voice:answer', async ({ from, sdp }) => {
        const pc = peerConnectionsRef.current.get(from);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      });

      socket.on('voice:ice-candidate', async ({ from, candidate }) => {
        const pc = peerConnectionsRef.current.get(from);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socket.on('voice:mute-changed', ({ socketId, isMuted: muted, isHardMuted }) => {
        setVoiceParticipants((prev) =>
          prev.map((p) => (p.socketId === socketId ? { ...p, isMuted: muted, isHardMuted } : p))
        );
        // If this mute change targets our own socket, sync actual mic track
        if (socketId === socket.id && muted) {
          setIsMuted(true);
          stream.getAudioTracks().forEach((track) => (track.enabled = false));
        }
      });

      socket.on('voice:muted-by-leader', ({ by, hard, message }) => {
        setMutedByLeaderMsg(message);
        setIsMuted(true);
        stream.getAudioTracks().forEach((track) => (track.enabled = false));
      });

      socket.on('voice:participants-update', ({ participants }) => {
        setVoiceParticipants(participants);
        // Sync actual mic track state when remote mute-all is received
        const myEntry = participants.find(p => p.socketId === socket.id);
        if (myEntry && myEntry.isMuted) {
          setIsMuted(true);
          stream.getAudioTracks().forEach((track) => (track.enabled = false));
        }
      });

      socket.on('voice:room-settings', ({ editorOnlyMode }) => {
        setEditorOnlyMode(editorOnlyMode);
      });

      // Simple mock indicator for active speaker
      socket.on('voice:speaker-active', ({ socketId }) => {
        setActiveSpeakerSocketId(socketId);
      });

      socket.on('voice:error', ({ message }) => {
        alert(message);
      });

    } catch (err) {
      alert(`Could not access microphone: ${err.message}`);
    }
  };

  const leaveVoice = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    if (voiceSocketRef.current) {
      voiceSocketRef.current.disconnect();
      voiceSocketRef.current = null;
    }
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    audioElementsRef.current.forEach((audio) => audio.remove());
    audioElementsRef.current.clear();
    setInVoice(false);
    setVoiceParticipants([]);
    setActiveSpeakerSocketId(null);
  };

  const createPeerConnection = (peerSocketId, stream, iceServers) => {
    const pc = new RTCPeerConnection({ iceServers });
    peerConnectionsRef.current.set(peerSocketId, pc);

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate && voiceSocketRef.current) {
        voiceSocketRef.current.emit('voice:ice-candidate', {
          to: peerSocketId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const peerStream = event.streams[0];
      let audio = audioElementsRef.current.get(peerSocketId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        audioElementsRef.current.set(peerSocketId, audio);
      }
      audio.srcObject = peerStream;
    };

    return pc;
  };

  const closePeerConnection = (peerSocketId) => {
    const pc = peerConnectionsRef.current.get(peerSocketId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerSocketId);
    }
    const audio = audioElementsRef.current.get(peerSocketId);
    if (audio) {
      audio.remove();
      audioElementsRef.current.delete(peerSocketId);
    }
  };

  const toggleMuteSelf = () => {
    if (!localStream || !voiceSocketRef.current) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMute;
    });

    voiceSocketRef.current.emit('voice:mute-self', { isMuted: nextMute });
  };

  // ─── LEADER CONTROLS ────────────────────────────────────────────────────────

  const toggleEditorOnlyVoice = () => {
    if (!voiceSocketRef.current) return;
    voiceSocketRef.current.emit('voice:set-editor-only', { enabled: !editorOnlyMode });
  };

  const handleMuteAll = () => {
    if (!voiceSocketRef.current) return;
    voiceSocketRef.current.emit('voice:mute-all');
  };

  const handleHardMuteParticipant = (targetSocketId, currentlyHard) => {
    if (!voiceSocketRef.current) return;
    if (currentlyHard) {
      voiceSocketRef.current.emit('voice:unmute-participant', { targetSocketId });
    } else {
      voiceSocketRef.current.emit('voice:mute-participant', { targetSocketId, hard: true });
    }
  };

  const handleRoleChange = async (targetUserId, newRole) => {
    try {
      await promoteMember(roomUuid, targetUserId, newRole);
      const details = await getRoomDetails(roomUuid);
      setRoom(details.room);
    } catch (err) {
      console.error('Failed to change role:', err.message);
      alert(`Failed to change role: ${err.message}`);
    }
  };

  const isUserLeader = role === 'Owner' || role === 'Room Leader';

  return (
    <div className="bg-surface text-on-surface font-ui overflow-hidden h-screen flex flex-col select-none">
      {/* Top Bar (44px) */}
      <header className="h-[44px] shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-3 z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center cursor-pointer" onClick={() => { leaveVoice(); onBack(); }}>
            <img src="/logo.png" className="h-10 object-contain" alt="CollabIDE Logo" />
          </div>
          <div className="h-4 w-px bg-outline mx-1" />
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              alert('Invite link copied!');
            }}
            className="text-sm text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1 group"
          >
            {room?.name || 'Loading room...'}
            <span className="material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-100 transition-opacity">content_copy</span>
          </button>
          
          {/* File tabs inside Top Bar */}
          <div className="flex items-center gap-px ml-2 overflow-x-auto no-scrollbar">
            {files.map((file) => (
              <button
                key={file.name}
                className={`px-3 h-[44px] text-sm flex items-center gap-2 border-b-2 transition-all ${
                  activeFile === file.name
                    ? 'text-on-surface bg-surface-elevated border-accent-blue'
                    : 'text-on-surface-variant border-transparent hover:bg-surface-elevated'
                }`}
                onClick={() => setActiveFile(file.name)}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
                {file.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunCode}
            disabled={isRunning || role === 'Viewer'}
            className="flex items-center gap-1.5 px-3 py-1 bg-accent-blue text-white text-sm font-medium rounded-md hover:opacity-90 transition-all disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            <span>Run</span>
          </button>

          <button
            onClick={() => setConsoleOpen(!consoleOpen)}
            className={`flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-md border transition-all ${
              consoleOpen
                ? 'bg-surface-elevated text-accent-blue border-accent-blue'
                : 'text-on-surface-variant border-outline hover:text-on-surface hover:bg-surface-elevated'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">terminal</span>
            <span>Terminal</span>
          </button>

          <div className="text-sm text-on-surface-variant bg-surface-elevated px-2.5 py-1 rounded border border-outline">
            {activeFile.endsWith('.py') ? 'Python' : 'JavaScript'}
          </div>

          <button
            className="flex items-center gap-1.5 px-2 py-1 text-sm text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-elevated"
            onClick={() => {
              setRightPanelOpen(true);
              setRightPanelTab('participants');
            }}
          >
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <span>{onlineCount} online</span>
          </button>

          <button
            className="w-7 h-7 rounded-full bg-accent-blue flex items-center justify-center text-white text-[10px] font-bold border border-white/20"
            style={{ backgroundColor: user.avatarColor }}
          >
            {user.displayName.charAt(0).toUpperCase()}
          </button>
        </div>
      </header>

      {/* Main container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar (48px) */}
        <aside className="w-[48px] h-full flex flex-col items-center py-3 bg-surface-base border-r border-outline-subtle shrink-0">
          <div className="flex flex-col gap-4 w-full items-center">
            <button
              className={`w-full py-2 border-l-2 transition-all ${
                sidebarOpen ? 'border-accent-blue text-accent-blue' : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <span className="material-symbols-outlined">folder</span>
            </button>
            <button
              className={`w-full py-2 border-l-2 transition-all ${
                rightPanelOpen && rightPanelTab === 'participants'
                  ? 'border-accent-blue text-accent-blue'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
              onClick={() => {
                if (rightPanelOpen && rightPanelTab === 'participants') {
                  setRightPanelOpen(false);
                } else {
                  setRightPanelOpen(true);
                  setRightPanelTab('participants');
                }
              }}
            >
              <span className="material-symbols-outlined">group</span>
            </button>
            <button
              className={`w-full py-2 border-l-2 transition-all ${
                rightPanelOpen && rightPanelTab === 'chat'
                  ? 'border-accent-blue text-accent-blue'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
              onClick={() => {
                if (rightPanelOpen && rightPanelTab === 'chat') {
                  setRightPanelOpen(false);
                } else {
                  setRightPanelOpen(true);
                  setRightPanelTab('chat');
                }
              }}
            >
              <span className="material-symbols-outlined">chat</span>
            </button>
          </div>

          <div className="mt-auto flex flex-col gap-4 w-full items-center">
            <button className="w-full py-2 text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined">settings</span>
            </button>
            <button
              className="w-full py-2 text-on-surface-variant hover:text-accent-red"
              onClick={() => { leaveVoice(); onBack(); }}
            >
              <span className="material-symbols-outlined">logout</span>
            </button>
          </div>
        </aside>

        {/* Sidebar explorer panel */}
        {sidebarOpen && (
          <nav className="w-[240px] h-full bg-surface-panel border-r border-outline-subtle flex flex-col shrink-0">
            <div className="p-4 flex items-center justify-between border-b border-outline-subtle">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-on-surface uppercase tracking-wider">Explorer</span>
                <span className="text-[11px] text-on-surface-muted">{room?.name || 'Workspace'} · {role}</span>
              </div>
              <div className="flex gap-1">
                <button className="p-1 text-on-surface-muted hover:text-on-surface rounded">
                  <span className="material-symbols-outlined text-[18px]">note_add</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <div className="px-3 py-1 flex items-center gap-2 text-on-surface text-sm font-semibold">
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
                <span>Files</span>
              </div>
              <div className="pl-4">
                {files.map((file) => (
                  <div
                    key={file.name}
                    className={`px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-all ${
                      activeFile === file.name
                        ? 'bg-surface-elevated border-l-2 border-accent-blue text-on-surface'
                        : 'text-on-surface-variant hover:bg-bg-hover'
                    }`}
                    onClick={() => setActiveFile(file.name)}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        file.name.endsWith('.js')
                          ? 'bg-yellow-400'
                          : file.name.endsWith('.py')
                          ? 'bg-blue-400'
                          : 'bg-gray-500'
                      }`}
                    />
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-outline-subtle mt-auto">
              <button
                className="w-full text-left text-[13px] text-accent-blue hover:underline flex items-center gap-1"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  alert('Share link copied!');
                }}
              >
                <Share2 size={13} /> Share invite link
              </button>
            </div>
          </nav>
        )}

        {/* Editor center workspace */}
        <main className="flex-1 flex flex-col min-w-0 bg-surface relative">
          <div className="flex-1 relative overflow-hidden">
            <Editor
              height="100%"
              path={activeFile}
              defaultLanguage={activeFile.endsWith('.md') ? 'markdown' : 'javascript'}
              theme="vs-dark"
              loading="Loading Editor Workspace..."
              onMount={handleEditorDidMount}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: false },
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                renderLineHighlight: 'gutter',
                automaticLayout: true,
                readOnly: role === 'Viewer',
              }}
            />

            {/* View only watermark */}
            {role === 'Viewer' && (
              <div className="absolute bottom-4 left-6 pointer-events-none select-none text-text-muted opacity-30 font-semibold tracking-wider text-[11px]">
                VIEW ONLY
              </div>
            )}

            {/* User editing count badge */}
            <div className="absolute bottom-4 right-6 glass-panel px-3 py-1.5 rounded-full flex items-center gap-2 border border-outline/30 shadow-lg z-10">
              <div className="flex -space-x-1.5">
                <div className="w-4 h-4 rounded-full bg-accent-blue border border-surface" />
                <div className="w-4 h-4 rounded-full bg-accent-green border border-surface" />
              </div>
              <span className="text-[11px] font-medium text-on-surface-variant">{onlineCount} editing</span>
            </div>
          </div>

          {/* Console / Output area */}
          {consoleOpen && (
            <section className="h-[200px] border-t border-outline flex flex-col bg-surface-panel relative shrink-0">
              <div className="absolute top-0 left-0 w-full h-[4px] bg-outline-subtle hover:bg-accent-blue cursor-row-resize transition-colors" />
              <div className="flex items-center justify-between px-2 h-9 border-b border-outline-subtle">
                <div className="flex h-full">
                  <button
                    className={`px-4 text-[13px] font-medium h-full transition-all ${
                      consoleTab === 'output' ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                    onClick={() => setConsoleTab('output')}
                  >
                    Output
                  </button>
                  <button
                    className={`px-4 text-[13px] font-medium h-full transition-all ${
                      consoleTab === 'terminal' ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                    onClick={() => setConsoleTab('terminal')}
                  >
                    Terminal
                  </button>
                  <button
                    className={`px-4 text-[13px] font-medium h-full transition-all ${
                      consoleTab === 'problems' ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                    onClick={() => setConsoleTab('problems')}
                  >
                    Problems
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1 text-on-surface-variant hover:text-on-surface rounded"
                    onClick={handleCopyOutput}
                    title="Copy Output"
                  >
                    <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  </button>
                  <button
                    className="p-1 text-on-surface-variant hover:text-on-surface rounded"
                    onClick={handleClearOutput}
                    title="Clear Output"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
                  </button>
                  <button
                    className="p-1 text-on-surface-variant hover:text-on-surface rounded"
                    onClick={() => setConsoleOpen(false)}
                    title="Minimize Console"
                  >
                    <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 p-4 font-code text-[12px] overflow-y-auto bg-[#0d0e0f]">
                {consoleTab === 'output' && (
                  <div className="text-on-surface">
                    {outputLines.length === 0 ? (
                      <div className="text-on-surface-muted italic">Click Run to compile code.</div>
                    ) : (
                      outputLines.map((line, idx) => (
                        <div
                          key={idx}
                          className={`output-line ${
                            line.type === 'success'
                              ? 'text-accent-green'
                              : line.type === 'err'
                              ? 'text-accent-red font-semibold'
                              : 'text-on-surface-muted'
                          } mt-1`}
                        >
                          {line.text}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {consoleTab === 'terminal' && (
                  <div className="text-on-surface-variant">
                    <div className="text-accent-green">$ CollabIDE interactive prompt active.</div>
                    <div className="flex items-center gap-1 mt-2">
                      <span className="text-on-surface">collab-ide/src %</span>
                      <span className="w-1.5 h-4 bg-on-surface-muted animate-pulse" />
                    </div>
                  </div>
                )}

                {consoleTab === 'problems' && (
                  <div className="text-on-surface-muted italic">No problems detected.</div>
                )}
              </div>
            </section>
          )}
        </main>

        {/* Right side tab panels (Participants / Chat) */}
        {rightPanelOpen && (
          <aside className="w-[280px] h-full bg-surface-panel border-l border-outline-subtle flex flex-col shrink-0">
            <div className="flex border-b border-outline-subtle">
              <button
                className={`flex-1 py-3 text-sm font-medium transition-all ${
                  rightPanelTab === 'participants'
                    ? 'text-accent-blue border-b-2 border-accent-blue'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                onClick={() => setRightPanelTab('participants')}
              >
                Participants ({onlineCount})
              </button>
              <button
                className={`flex-1 py-3 text-sm font-medium transition-all ${
                  rightPanelTab === 'chat'
                    ? 'text-accent-blue border-b-2 border-accent-blue'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                onClick={() => setRightPanelTab('chat')}
              >
                Chat
              </button>
            </div>

            {rightPanelTab === 'participants' && (
              <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">Online</span>
                  {isUserLeader && (
                    <div className="flex gap-2 text-[11px]">
                      <button onClick={handleMuteAll} className="text-accent-red hover:underline">Mute all</button>
                      <button onClick={toggleEditorOnlyVoice} className="text-accent-blue hover:underline">
                        {editorOnlyMode ? 'Unlock Voice' : 'Lock Voice'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Local user entry */}
                <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-elevated">
                  <div className="relative">
                    <div
                      className="w-8 h-8 rounded-full bg-accent-blue flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: user.avatarColor }}
                    >
                      {user.displayName.charAt(0).toUpperCase()}
                    </div>
                    {inVoice && !isMuted && (
                      <div className="absolute inset-0 rounded-full border border-accent-green speaking-pulse" />
                    )}
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-accent-green border-2 border-surface-panel rounded-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-on-surface truncate">{user.displayName} (You)</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#3d3000] text-[#f9ab00] rounded-sm font-medium uppercase">
                        {role}
                      </span>
                    </div>
                    <span className="text-[11px] text-accent-green">
                      {inVoice ? (isMuted ? 'Muted' : 'Speaking...') : 'Offline Voice'}
                    </span>
                  </div>
                </div>

                {/* Remote workspace participants (synced via Yjs awareness) */}
                {activeWorkspaceUsers
                  .filter((p) => p.id !== (user.id || user._id))
                  .map((p) => {
                    const voiceP = voiceParticipants.find((vp) => vp.userId === p.id);
                    const getRoleBadgeClass = (userRole) => {
                      switch (userRole) {
                        case 'Owner': return 'bg-[#3d3000] text-[#f9ab00]';
                        case 'Room Leader': return 'bg-[#2a0e38] text-[#cba6f7]';
                        case 'Editor': return 'bg-[#0a2510] text-[#34a853]';
                        default: return 'bg-[#181825] text-on-surface-muted';
                      }
                    };

                    return (
                      <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-elevated group">
                        <div className="relative">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ backgroundColor: p.color || '#89b4fa' }}
                          >
                            {(p.name || 'U').charAt(0).toUpperCase()}
                          </div>
                          {voiceP && activeSpeakerSocketId === voiceP.socketId && (
                            <div className="absolute inset-0 rounded-full border border-accent-green speaking-pulse" />
                          )}
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-accent-green border-2 border-surface-panel rounded-full" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-sm font-medium text-on-surface truncate">{p.name}</span>
                            {isUserLeader ? (
                              <select
                                value={p.role || 'Viewer'}
                                onChange={(e) => handleRoleChange(p.id, e.target.value)}
                                className="bg-[#1e1e2e] border border-outline-subtle rounded text-[10px] text-on-surface px-1 py-0.5 outline-none cursor-pointer focus:border-accent-blue"
                              >
                                <option value="Viewer">Viewer</option>
                                <option value="Editor">Editor</option>
                                {role === 'Owner' && <option value="Room Leader">Room Leader</option>}
                              </select>
                            ) : (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium uppercase ${getRoleBadgeClass(p.role)}`}>
                                {p.role || 'Viewer'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-on-surface-muted">
                            {voiceP ? (
                              voiceP.isMuted ? (
                                <>
                                  <MicOff size={11} className="text-accent-red" />
                                  <span>Muted</span>
                                </>
                              ) : (
                                <span>Speaking...</span>
                              )
                            ) : (
                              <span>Offline Voice</span>
                            )}
                          </div>
                        </div>

                        {isUserLeader && voiceP && (
                          <button
                            onClick={() => handleHardMuteParticipant(voiceP.socketId, voiceP.isHardMuted)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-on-surface-muted hover:text-on-surface"
                            title={voiceP.isHardMuted ? 'Release hard mute' : 'Hard mute member'}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {rightPanelTab === 'chat' && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div
                  id="chat-msg-container"
                  className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 bg-[#121414]"
                >
                  {chatMessages.map((msg, idx) => {
                    const isMine = msg.userId === (user.id || user._id);
                    return (
                      <div key={idx} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                            style={{ backgroundColor: msg.avatarColor }}
                          >
                            {msg.displayName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-semibold text-on-surface" style={{ color: msg.avatarColor }}>
                            {msg.displayName}
                          </span>
                          <span className="text-[9px] text-on-surface-muted ml-auto">{msg.time}</span>
                        </div>
                        <div className="pl-8 text-sm text-text-primary whitespace-pre-wrap">{msg.text}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 border-t border-outline-subtle bg-surface-panel flex items-center gap-2">
                  <input
                    type="text"
                    className="flex-1 bg-surface border border-outline rounded-md px-3 py-1.5 text-sm text-on-surface focus:border-accent-blue focus:ring-0 outline-none transition-colors"
                    placeholder="Type a message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  />
                  <button
                    onClick={handleSendChat}
                    className="p-1.5 bg-accent-blue text-white rounded-md hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Status Bar */}
      <footer className="h-[22px] bg-accent-blue text-white px-3 flex items-center justify-between text-[11px] shrink-0 z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-green shadow-[0_0_4px_rgba(30,142,62,0.6)]" />
            <span>{syncStatus}</span>
          </div>
          <div className="h-3 w-px bg-white/20" />
          <span>{onlineCount} online</span>
        </div>
        <div className="flex items-center gap-4">
          <span>{activeFile.endsWith('.js') ? 'JavaScript' : 'Python'}</span>
          <div className="h-3 w-px bg-white/20" />
          <span className="cursor-pointer hover:underline" onClick={() => navigator.clipboard.writeText(roomUuid)}>
            Room: {roomUuid.slice(0, 8)}
          </span>
          <div className="h-3 w-px bg-white/20" />
          <span>UTF-8</span>
        </div>
      </footer>

      {/* Floating Voice Dock */}
      <div className="fixed bottom-[34px] left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 h-[56px] glass-panel rounded-full border border-outline/50 shadow-2xl z-50 transition-all hover:scale-[1.01]">
        <div className="flex items-center gap-2">
          {inVoice ? (
            <button
              onClick={toggleMuteSelf}
              className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                isMuted ? 'bg-red-950/40 text-accent-red hover:bg-red-900/40' : 'hover:bg-surface-elevated text-on-surface-variant'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              <span className="material-symbols-outlined">{isMuted ? 'mic_off' : 'mic'}</span>
            </button>
          ) : (
            <button
              onClick={joinVoice}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-elevated text-on-surface-variant transition-colors"
              title="Connect Voice"
            >
              <Volume2 size={18} />
            </button>
          )}

          <button
            onClick={() => {
              setRightPanelOpen(true);
              setRightPanelTab('chat');
            }}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-elevated text-on-surface-variant transition-colors"
            title="Open Chat"
          >
            <span className="material-symbols-outlined">chat</span>
          </button>
          <button
            onClick={() => {
              setRightPanelOpen(true);
              setRightPanelTab('participants');
            }}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-elevated text-on-surface-variant transition-colors"
            title="Participants"
          >
            <span className="material-symbols-outlined">group</span>
          </button>
        </div>

        {inVoice && (
          <>
            <div className="w-px h-6 bg-outline mx-1" />
            <div className="flex items-center gap-2">
              {isUserLeader && (
                <>
                  <button onClick={handleMuteAll} className="px-3 py-1 text-[12px] font-medium text-accent-red hover:bg-accent-red/10 rounded-md transition-colors">
                    Mute all
                  </button>
                  <button onClick={toggleEditorOnlyVoice} className="px-3 py-1 text-[12px] font-medium text-accent-blue hover:bg-accent-blue/10 rounded-md transition-colors">
                    {editorOnlyMode ? 'Unlock voice' : 'Lock voice'}
                  </button>
                </>
              )}
              <button
                onClick={leaveVoice}
                className="ml-2 px-4 h-9 flex items-center justify-center rounded-full bg-accent-red text-white text-[13px] font-medium hover:opacity-90 transition-all gap-2"
              >
                <PhoneOff size={14} />
                <span>Leave</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Admin lock overlay notifications */}
      {mutedByLeaderMsg && (
        <div className="fixed bottom-24 left-6 z-50 bg-[#1b1c1c] border-l-4 border-accent-red px-4 py-3 rounded-lg shadow-2xl max-w-sm">
          <div className="flex items-center gap-2 text-accent-red font-semibold text-sm">
            <MicOff size={16} /> Muted by Room Leader
          </div>
          <div className="text-xs text-on-surface-variant mt-1">{mutedByLeaderMsg}</div>
        </div>
      )}
    </div>
  );
}
