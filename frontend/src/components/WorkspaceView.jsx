import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs';
import { useVoiceRoom } from '../hooks/useVoiceRoom';
import VoiceDeviceMenu from './VoiceDeviceMenu';
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
  getRooms,
  closeRoom,
  openRoom,
  deleteRoom,
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
  Copy,
  Trash2,
  X,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

// WhatsApp strategy color palette for distinguishable user colors in group chat (contrasty in dark mode)
const WHATSAPP_CHAT_COLORS = [
  '#4ade80', // Green
  '#2dd4bf', // Teal
  '#38bdf8', // Light Blue
  '#c084fc', // Lavender/Purple
  '#f472b6', // Pink
  '#fb923c', // Orange
  '#fbbf24', // Amber/Yellow
  '#a3e635', // Lime
  '#fda4af', // Rose
  '#60a5fa', // Blue
];

const getUserColor = (userId, displayName) => {
  const identifier = userId || displayName || '';
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % WHATSAPP_CHAT_COLORS.length;
  return WHATSAPP_CHAT_COLORS[index];
};

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

/**
 * Converts a flat array of file path strings into a nested tree structure.
 * e.g. ['src/main.js', 'README.md'] ->
 *   [ { type:'folder', name:'src', path:'src', children:[{type:'file',name:'main.js',path:'src/main.js'}] },
 *     { type:'file', name:'README.md', path:'README.md' } ]
 */
function buildFileTree(files) {
  const root = [];
  files.forEach(file => {
    const fullPath = file.name || file;
    const parts = fullPath.split('/');
    if (parts.length === 1) {
      root.push({ type: 'file', name: parts[0], path: parts[0] });
    } else {
      let current = root;
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
        let folder = current.find(n => n.type === 'folder' && n.name === folderName);
        if (!folder) {
          folder = { type: 'folder', name: folderName, path: currentPath, children: [] };
          current.push(folder);
        }
        current = folder.children;
      }
      const fileName = parts[parts.length - 1];
      if (fileName !== '.gitkeep') {
        current.push({ type: 'file', name: fileName, path: fullPath });
      }
    }
  });
  return root;
}

export default function WorkspaceView({ roomUuid, user, onBack, onRoomSelect }) {
  const [room, setRoom] = useState(null);
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [showRoomDropdown, setShowRoomDropdown] = useState(false);

  useEffect(() => {
    getRooms().then(rooms => setJoinedRooms(rooms)).catch(console.error);
  }, []);
  const [role, setRole] = useState('Viewer');
  const [files, setFiles] = useState([]);
  const [openedFiles, setOpenedFiles] = useState([]);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileNameInput, setNewFileNameInput] = useState('');
  const [renamingFileName, setRenamingFileName] = useState(null);
  const [renameInputVal, setRenameInputVal] = useState('');
  const [activeFileMenu, setActiveFileMenu] = useState(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);
  const [isLastFileWarning, setIsLastFileWarning] = useState(false);
  const [toastMessage, setToastMessage] = useState(null); // { text, type: 'success'|'error'|'warning'|'info' }
  const toastTimerRef = useRef(null);

  const showToast = (text, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage({ text, type });
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2500);
  };
  const [activeFile, setActiveFile] = useState('main.js');
  const [isSyncing, setIsSyncing] = useState(true);
  const [syncStatus, setSyncStatus] = useState('Connecting…');
  const [onlineCount, setOnlineCount] = useState(0);

  // Panels visibility
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState('participants'); // participants, chat
  const [isOnlineListOpen, setIsOnlineListOpen] = useState(true);
  const [isFilesTreeOpen, setIsFilesTreeOpen] = useState(true);
  const [activeMenuDropdown, setActiveMenuDropdown] = useState(null);
  // Folder support state
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderNameInput, setNewFolderNameInput] = useState('');
  const [createInsideFolder, setCreateInsideFolder] = useState('');
  const [folderMenuTarget, setFolderMenuTarget] = useState(null); // { path, x, y }
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [consoleHeight, setConsoleHeight] = useState(200);
  const [leftPanelWidth, setLeftPanelWidth] = useState(200);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRoomDeletedModal, setShowRoomDeletedModal] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [consoleTab, setConsoleTab] = useState('output'); // output, terminal, problems

  // Code run/output
  const [outputLines, setOutputLines] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Refs for Yjs and peer connections
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const [ydoc, setYdoc] = useState(null);
  const [provider, setProvider] = useState(null);
  const monacoBindingRef = useRef(null);
  const voiceSocketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // socketId -> RTCPeerConnection
  const roomRef = useRef(null);
  const isCommittingFileRef = useRef(false);
  const audioElementsRef = useRef(new Map()); // socketId -> HTMLAudioElement

  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeWorkspaceUsers, setActiveWorkspaceUsers] = useState([]);

  const voice = useVoiceRoom({ roomUuid, showToast });
  const {
    inVoice,
    localStream,
    voiceParticipants,
    isMuted,
    mutedByLeaderMsg,
    editorOnlyMode,
    activeSpeakerSocketId,
    joinVoice,
    leaveVoice,
    toggleMuteSelf,
    toggleEditorOnlyVoice,
    handleMuteAll,
    handleHardMuteParticipant,
    selectedMicId,
    selectedSpeakerId,
    updateDevices
  } = voice;

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
        roomRef.current = details.room;
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

    // Connect to backend for WebSocket (support Vite dev on :5173, Nginx reverse proxy on :80/:443, or cloud deployment)
    const isViteDev = window.location.port === '5173';
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const wsUrl = isViteDev 
      ? `ws://${window.location.hostname}:3000` 
      : (isLocal 
          ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws` 
          : 'wss://collabide-backend-avau.onrender.com');

    const providerInstance = new WebsocketProvider(wsUrl, roomUuid, yDocInstance, {
      params: { token: getToken() },
    });
    setProvider(providerInstance);

    const yfilesInstance = yDocInstance.getArray(`${roomUuid}:files`);
    const updateFilesFromYjs = () => {
      const currentNames = yfilesInstance.toArray();
      // Deduplicate file names to prevent concurrent client initialization race conditions
      const uniqueNames = Array.from(new Set(currentNames));
      if (uniqueNames.length > 0) {
        setFiles(uniqueNames.map(name => ({ name })));
      }
    };
    yfilesInstance.observe(updateFilesFromYjs);

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
              } else if (data.type === 'room_closed') {
                console.log('[WS] Room closed by owner');
                setRoom((prev) => prev ? { ...prev, isClosed: true } : prev);
                leaveVoice(); // kick out of voice
              } else if (data.type === 'room_opened') {
                console.log('[WS] Room opened by owner');
                setRoom((prev) => prev ? { ...prev, isClosed: false } : prev);
              } else if (data.type === 'room_deleted') {
                console.log('[WS] Room deleted by owner');
                setShowRoomDeletedModal(true);
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
      yfilesInstance.unobserve(updateFilesFromYjs);
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
        color: getUserColor(user.id || user._id, user.displayName),
        id: user.id || user._id,
        role: role,
      });
    }
  }, [provider, role, user]);

  // Open first file by default on initial workspace load
  useEffect(() => {
    if (files.length > 0 && openedFiles.length === 0) {
      const firstFile = files[0].name;
      setOpenedFiles([firstFile]);
      setActiveFile(firstFile);
    }
  }, [files]);

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

    // Enforce read-only behavior by intercepting keyboard events, bypassing y-monaco readOnly lock issues
    editor.onKeyDown((e) => {
      if (window._collabIdeReadOnly) {
        // Allow navigation keys
        const allowedKeys = [
          monaco.KeyCode.UpArrow, monaco.KeyCode.DownArrow,
          monaco.KeyCode.LeftArrow, monaco.KeyCode.RightArrow,
          monaco.KeyCode.PageUp, monaco.KeyCode.PageDown,
          monaco.KeyCode.Home, monaco.KeyCode.End,
          monaco.KeyCode.Escape
        ];
        
        // Allow Ctrl+C, Ctrl+A, Ctrl+F
        if (e.ctrlKey || e.metaKey) {
          if (
            e.keyCode === monaco.KeyCode.KeyC || 
            e.keyCode === monaco.KeyCode.KeyA || 
            e.keyCode === monaco.KeyCode.KeyF
          ) {
            return;
          }
        }
        
        if (!allowedKeys.includes(e.keyCode)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });

    bindEditorModel(activeFile);
  };

  const bindEditorModel = (fileName) => {
    if (!editorRef.current || !ydoc || !provider) return;

    const ytext = ydoc.getText(`${roomUuid}:${fileName}`);

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;
    model.setEOL(0); // Enforce LF line endings (0) to prevent cursor offset misalignment between CRLF and LF clients

    const isReadOnly = room?.isClosed || role === 'Viewer' || (editorOnlyMode && role === 'Editor' && !inVoice);

    if (monacoBindingRef.current) {
      if (typeof monacoBindingRef.current.destroy === 'function') {
        monacoBindingRef.current.destroy();
      } else {
        ytext.unobserve(monacoBindingRef.current);
      }
      monacoBindingRef.current = null;
    }

    if (isReadOnly) {
      const updateModel = () => {
        const text = ytext.toString();
        if (model.getValue() !== text) {
          model.setValue(text);
        }
      };
      updateModel();
      ytext.observe(updateModel);
      monacoBindingRef.current = updateModel;
    } else {
      import('y-monaco').then(({ MonacoBinding }) => {
        if (monacoBindingRef.current) return;
        monacoBindingRef.current = new MonacoBinding(
          ytext,
          model,
          new Set([editor]),
          provider.awareness
        );
      });
    }
  };

  useEffect(() => {
    if (editorRef.current && ydoc && provider) {
      bindEditorModel(activeFile);
    }
  }, [activeFile, ydoc, provider, role, editorOnlyMode, inVoice]);

  // Run code handler
  const handleRunCode = async () => {
    if (!editorRef.current || isRunning) return;
    setIsRunning(true);
    setConsoleOpen(true);
    setConsoleTab('output');
    setOutputLines((prev) => [...prev, { text: `> Running ${activeFile}...`, type: 'info' }]);

    try {
      const code = editorRef.current.getValue();
      const language = activeFile.endsWith('.py')
        ? 'python'
        : activeFile.endsWith('.java')
        ? 'java'
        : (activeFile.endsWith('.cpp') || activeFile.endsWith('.cc'))
        ? 'cpp'
        : activeFile.endsWith('.c')
        ? 'c'
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
      navigator.clipboard.writeText(textToCopy).then(() => showToast('Console output copied!', 'success')).catch(() => showToast('Failed to copy output', 'error'));
    }
  };

  // Clear console output
  const handleClearOutput = () => {
    setOutputLines([]);
  };

  // Resize console height via mouse drag

  const handleLeftPanelResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const doResize = (moveEvent) => {
      setLeftPanelWidth(Math.max(150, Math.min(startWidth + (moveEvent.clientX - startX), 600)));
    };
    const stopResize = () => {
      window.removeEventListener('mousemove', doResize);
      window.removeEventListener('mouseup', stopResize);
    };
    window.addEventListener('mousemove', doResize);
    window.addEventListener('mouseup', stopResize);
  };

  const handleRightPanelResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    const doResize = (moveEvent) => {
      setRightPanelWidth(Math.max(250, Math.min(startWidth - (moveEvent.clientX - startX), 600)));
    };
    const stopResize = () => {
      window.removeEventListener('mousemove', doResize);
      window.removeEventListener('mouseup', stopResize);
    };
    window.addEventListener('mousemove', doResize);
    window.addEventListener('mouseup', stopResize);
  };

  const handleConsoleResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = consoleHeight;

    const doResize = (moveEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(100, Math.min(600, startHeight + deltaY));
      setConsoleHeight(newHeight);
    };

    const stopResize = () => {
      window.removeEventListener('mousemove', doResize);
      window.removeEventListener('mouseup', stopResize);
    };

    window.addEventListener('mousemove', doResize);
    window.addEventListener('mouseup', stopResize);
  };

  // Create new file dynamically (VS Code style inline creation)
  const handleCreateFile = (parentFolderPath = '') => {
    if (role === 'Viewer') {
      showToast('Viewers cannot create files. Ask the Room Leader to promote you.', 'warning');
      return;
    }
    if (!ydoc) return;
    setCreateInsideFolder(parentFolderPath);
    setIsCreatingFile(true);
    setNewFileNameInput('');
    isCommittingFileRef.current = false;
    // Auto-expand the target folder
    if (parentFolderPath) {
      setExpandedFolders(prev => new Set([...prev, parentFolderPath]));
    }
  };

  // Create new folder (inserts a .gitkeep placeholder to represent it)
  const handleCreateFolder = (parentFolderPath = '') => {
    if (role === 'Viewer') {
      showToast('Viewers cannot create folders.', 'warning');
      return;
    }
    if (!ydoc) return;
    setCreateInsideFolder(parentFolderPath);
    setIsCreatingFolder(true);
    setNewFolderNameInput('');
    if (parentFolderPath) {
      setExpandedFolders(prev => new Set([...prev, parentFolderPath]));
    }
  };

  const handleCommitNewFolder = () => {
    const trimmed = newFolderNameInput.trim();
    if (!trimmed) {
      setIsCreatingFolder(false);
      return;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(trimmed)) {
      showToast('Invalid folder name. Only letters, numbers, dashes, and underscores allowed.', 'error');
      setTimeout(() => document.getElementById('new-folder-input')?.focus(), 50);
      return;
    }
    const folderPath = createInsideFolder ? `${createInsideFolder}/${trimmed}` : trimmed;
    const placeholderPath = `${folderPath}/.gitkeep`;
    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    if (yfiles.toArray().some(f => f === placeholderPath || f.startsWith(`${folderPath}/`))) {
      showToast('A folder with this name already exists.', 'warning');
      setTimeout(() => document.getElementById('new-folder-input')?.focus(), 50);
      return;
    }
    yfiles.push([placeholderPath]);
    setExpandedFolders(prev => new Set([...prev, folderPath]));
    setIsCreatingFolder(false);
    setNewFolderNameInput('');
  };

  const handleNewFolderKeyDown = (e) => {
    if (e.key === 'Enter') handleCommitNewFolder();
    else if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderNameInput(''); }
  };

  const handleDeleteFolder = (folderPath) => {
    if (role === 'Viewer') return;
    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    const fileNames = yfiles.toArray();
    const indices = fileNames
      .map((name, idx) => ({ name, idx }))
      .filter(({ name }) => name === `${folderPath}/.gitkeep` || name.startsWith(`${folderPath}/`))
      .map(({ idx }) => idx);
    ydoc.transact(() => {
      [...indices].sort((a, b) => b - a).forEach(idx => yfiles.delete(idx, 1));
    });
    setOpenedFiles(prev => prev.filter(f => !f.startsWith(`${folderPath}/`)));
    if (activeFile.startsWith(`${folderPath}/`)) {
      const remaining = fileNames.filter(f => !f.startsWith(`${folderPath}/`) && f !== `${folderPath}/.gitkeep`);
      setActiveFile(remaining[0] || '');
    }
    setExpandedFolders(prev => { const s = new Set(prev); s.delete(folderPath); return s; });
    showToast(`Folder "${folderPath.split('/').pop()}" deleted`, 'success');
  };

  const handleCommitNewFile = () => {
    if (isCommittingFileRef.current) return;
    isCommittingFileRef.current = true;

    const trimmed = newFileNameInput.trim();
    if (!trimmed) {
      setIsCreatingFile(false);
      isCommittingFileRef.current = false;
      return;
    }

    // Basic filename safety validation
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(trimmed)) {
      showToast('Invalid file name. Only alphanumeric, dashes, underscores, and dots allowed.', 'error');
      isCommittingFileRef.current = false;
      setTimeout(() => {
        document.getElementById('new-file-input')?.focus();
      }, 50);
      return;
    }

    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    // Build full path (prefix with parent folder if creating inside one)
    const fullPath = createInsideFolder ? `${createInsideFolder}/${trimmed}` : trimmed;
    if (yfiles.toArray().includes(fullPath)) {
      showToast('A file with this name already exists.', 'warning');
      isCommittingFileRef.current = false;
      setTimeout(() => {
        document.getElementById('new-file-input')?.focus();
      }, 50);
      return;
    }

    // Push new file path to shared Yjs array
    yfiles.push([fullPath]);
    setActiveFile(fullPath);
    setOpenedFiles(prev => prev.includes(fullPath) ? prev : [...prev, fullPath]);
    setIsCreatingFile(false);
    setNewFileNameInput('');
    setCreateInsideFolder('');
    isCommittingFileRef.current = false;
  };

  const handleNewFileKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleCommitNewFile();
    } else if (e.key === 'Escape') {
      setIsCreatingFile(false);
      setNewFileNameInput('');
      isCommittingFileRef.current = false;
    }
  };

  const handleFileDoubleClick = (e, fileName) => {
    e.preventDefault();
    if (role === 'Viewer') return; // Viewers can't modify files
    setActiveFileMenu({
      fileName,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleRenameFile = (oldName) => {
    if (role === 'Viewer') return;
    setRenamingFileName(oldName);
    setRenameInputVal(oldName);
    isCommittingFileRef.current = false;
  };

  const handleCommitRename = (oldName) => {
    if (isCommittingFileRef.current) return;
    isCommittingFileRef.current = true;

    const trimmed = renameInputVal.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingFileName(null);
      isCommittingFileRef.current = false;
      return;
    }

    // Basic safety validation
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(trimmed)) {
      showToast('Invalid file name. Only alphanumeric, dashes, underscores, and dots allowed.', 'error');
      isCommittingFileRef.current = false;
      setTimeout(() => {
        document.getElementById('rename-file-input')?.focus();
      }, 50);
      return;
    }

    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    if (yfiles.toArray().includes(trimmed)) {
      showToast('A file with this name already exists.', 'warning');
      isCommittingFileRef.current = false;
      setTimeout(() => {
        document.getElementById('rename-file-input')?.focus();
      }, 50);
      return;
    }

    // Collaborative Yjs Rename logic: copy content, then swap entries
    const oldYText = ydoc.getText(`${roomUuid}:${oldName}`);
    const newYText = ydoc.getText(`${roomUuid}:${trimmed}`);
    
    ydoc.transact(() => {
      newYText.insert(0, oldYText.toString());
      
      const fileNames = yfiles.toArray();
      const idx = fileNames.indexOf(oldName);
      if (idx !== -1) {
        yfiles.delete(idx, 1);
        yfiles.insert(idx, [trimmed]);
      }
    });

    if (activeFile === oldName) {
      setActiveFile(trimmed);
    }

    // Rename inside opened tabs list if present
    setOpenedFiles(prev => prev.map(name => name === oldName ? trimmed : name));

    setRenamingFileName(null);
    setRenameInputVal('');
    isCommittingFileRef.current = false;
  };

  const handleRenameKeyDown = (e, oldName) => {
    if (e.key === 'Enter') {
      handleCommitRename(oldName);
    } else if (e.key === 'Escape') {
      setRenamingFileName(null);
      setRenameInputVal('');
      isCommittingFileRef.current = false;
    }
  };

  const handleDeleteFile = (fileName) => {
    if (role === 'Viewer') return;
    // Don't delete the last file to ensure stability
    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    if (yfiles.length <= 1) {
      setDeleteConfirmFile(fileName);
      setIsLastFileWarning(true);
      return;
    }

    // Show custom confirmation modal
    setIsLastFileWarning(false);
    setDeleteConfirmFile(fileName);
  };

  const handleConfirmDelete = () => {
    if (!deleteConfirmFile || !ydoc) return;
    const yfiles = ydoc.getArray(`${roomUuid}:files`);
    const fileNames = yfiles.toArray();
    const idx = fileNames.indexOf(deleteConfirmFile);
    if (idx !== -1) {
      yfiles.delete(idx, 1);
    }

    if (activeFile === deleteConfirmFile) {
      const remaining = fileNames.filter(name => name !== deleteConfirmFile);
      setActiveFile(remaining[0]);
    }

    // Remove from opened tabs list if present
    setOpenedFiles(prev => prev.filter(name => name !== deleteConfirmFile));
    setDeleteConfirmFile(null);
  };

  // Close an opened tab
  const handleCloseFile = (fileName) => {
    const updated = openedFiles.filter((name) => name !== fileName);
    setOpenedFiles(updated);

    if (activeFile === fileName) {
      if (updated.length > 0) {
        setActiveFile(updated[updated.length - 1]);
      } else {
        setActiveFile('');
      }
    }
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

  const handleRoleChange = async (targetUserId, newRole) => {
    try {
      await promoteMember(roomUuid, targetUserId, newRole);
      const details = await getRoomDetails(roomUuid);
      setRoom(details.room);
    } catch (err) {
      console.error('Failed to change role:', err.message);
      showToast(`Failed to change role: ${err.message}`, 'error');
    }
  };

  const isUserLeader = role === 'Owner' || role === 'Room Leader';

  return (
    <div className="bg-surface text-on-surface font-ui overflow-hidden h-screen flex flex-col select-none">
      {/* Top Bar (56px) */}
      <header className="h-top-bar-height shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-1">
          <div className="flex items-center cursor-pointer" onClick={() => { leaveVoice(); onBack(); }}>
            <img src="/logo.png" className="h-10 object-contain" alt="CollabIDE Logo" />
          
      </div>
          <div className="h-4 w-px bg-outline mx-1" />
          <div className="relative">
            <button
              onClick={() => setShowRoomDropdown(!showRoomDropdown)}
              className="text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1.5 group"
            >
              {room?.name || 'Loading room...'}
              <ChevronDown size={14} className={`transition-transform duration-200 ${showRoomDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showRoomDropdown && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-surface-panel border border-outline-subtle rounded-md shadow-lg z-50 overflow-hidden">
                <div className="p-2 border-b border-outline-subtle flex justify-between items-center">
                  <span className="text-[10px] font-semibold text-on-surface-muted uppercase tracking-wider">Switch Workspace</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRoomDropdown(false);
                    }}
                    className="p-0.5 text-on-surface-muted hover:text-on-surface hover:bg-[#2b2d30] rounded"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto py-1">
                  {joinedRooms.map(r => (
                    <button
                      key={r.uuid}
                      className={`w-full text-left px-3 py-1.5 text-[11.5px] font-medium hover:bg-[#2b2d30] transition-colors ${r.uuid === roomUuid ? 'text-[#9fcaff] bg-[#1c2b41]/30' : 'text-on-surface'}`}
                      onClick={() => {
                        setShowRoomDropdown(false);
                        if (r.uuid !== roomUuid && onRoomSelect) {
                          onRoomSelect(r.uuid);
                        }
                      }}
                    >
                      {r.name}
                    </button>
                  ))}
                  {joinedRooms.length === 0 && (
                    <div className="px-3 py-2 text-[11px] text-on-surface-muted italic">No other workspaces</div>
                  )}
                </div>
                <div className="p-2 border-t border-outline-subtle bg-black/20">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.href);
                      showToast('Invite link copied!', 'success');
                      setShowRoomDropdown(false);
                    }}
                    className="w-full text-left text-[11px] font-medium text-accent-blue hover:bg-accent-blue/10 px-2 py-1.5 rounded transition-colors flex items-center gap-1.5"
                  >
                    <Copy size={13} /> Copy Invite Link
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* File tabs inside Top Bar */}
          <div className="flex items-center gap-1.5 ml-3 overflow-x-auto no-scrollbar">
            {openedFiles.map((fileName) => (
              <div
                key={fileName}
                className={`px-3 h-[36px] text-[9.5px] flex items-center gap-1 border-b-[3px] transition-all group/tab ${
                  activeFile === fileName
                    ? 'text-accent-blue border-accent-blue bg-transparent'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30] border-transparent'
                }`}
              >
                <button
                  className="flex items-center gap-1 h-full outline-none focus:outline-none"
                  onClick={() => setActiveFile(fileName)}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
                  <span title={fileName}>{fileName.split('/').pop()}</span>
                </button>
                <button
                  className="text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30] rounded p-0.5 ml-1 flex items-center justify-center opacity-40 hover:opacity-100 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseFile(fileName);
                  }}
                  title="Close Tab"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRunCode}
            disabled={isRunning || role === 'Viewer' || !activeFile || activeFile.endsWith('.md')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-white text-[10px] font-medium rounded-md transition-all shadow-sm ${
              (isRunning || role === 'Viewer' || !activeFile || activeFile.endsWith('.md'))
                ? 'bg-[#2b2d30] text-on-surface-muted cursor-not-allowed'
                : 'bg-accent-blue hover:bg-accent-blue/90 shadow-accent-blue/20'
            }`}
          >
            <Play size={12} fill="currentColor" />
            <span>Run</span>
          </button>


          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${
              rightPanelOpen ? 'bg-[#1c2b41]/60 text-[#9fcaff]' : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
            }`}
            title={rightPanelOpen ? 'Collapse Panel' : 'Expand Panel'}
          >
            {rightPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>

          <button
            className="w-7 h-7 rounded-full shrink-0 bg-accent-blue flex items-center justify-center text-white text-[9px] font-bold border border-white/20"
            style={{ backgroundColor: getUserColor(user.id || user._id, user.displayName) }}
          >
            {user.displayName.charAt(0).toUpperCase()}
          </button>
        </div>
      </header>

      {/* Main container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar (48px) */}
        <aside className="w-activity-bar-width h-full flex flex-col items-center py-2 bg-surface-base border-r border-outline-subtle shrink-0">
          <div className="flex flex-col gap-2 w-full items-center">
            <button
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                sidebarOpen ? 'bg-[#1c2b41]/60 text-[#9fcaff]' : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
              }`}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Explorer"
            >
              <Folder size={18} strokeWidth={2.5} />
            </button>
          </div>

          <div className="mt-auto flex flex-col gap-2 w-full items-center">
            {role === 'Owner' && (
              <button 
                className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30] transition-colors" 
                title="Settings"
                onClick={() => setShowSettingsModal(true)}
              >
                <Settings size={18} />
              </button>
            )}
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-accent-red hover:bg-red-950/30 transition-colors"
              onClick={() => { leaveVoice(); onBack(); }}
              title="Exit Room"
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>

        {/* Sidebar explorer panel */}
          {sidebarOpen && (
            <nav style={{ width: `${leftPanelWidth}px` }} className="h-full bg-[#181818] border-r border-outline-subtle flex flex-col shrink-0 select-none relative">
              <div className="absolute top-0 right-0 w-[4px] h-full bg-transparent hover:bg-accent-blue cursor-col-resize transition-colors z-50 translate-x-1/2" onMouseDown={handleLeftPanelResize} />
              
              {/* Explorer Top Header */}
              <div className="px-5 py-2.5 flex items-center justify-between text-on-surface-muted">
                <span className="text-[11px] text-on-surface uppercase tracking-wide">Explorer</span>
                <button className="p-0.5 hover:bg-[#2a2d2e] rounded"><MoreHorizontal size={14} /></button>
              </div>

              <div className="flex-1 overflow-y-auto outline-none custom-scrollbar pb-4" tabIndex={0}>
                {/* Workspace Root Row */}
                <div 
                  className="px-1 py-1 flex items-center justify-between group/root cursor-pointer hover:bg-[#2a2d2e] transition-colors"
                  onClick={() => setIsFilesTreeOpen(!isFilesTreeOpen)}
                >
                  <div className="flex items-center gap-0.5 min-w-0 flex-1">
                    <span
                      className="material-symbols-outlined text-[16px] text-on-surface-muted transition-transform duration-150 shrink-0"
                      style={{ transform: isFilesTreeOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      chevron_right
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface truncate">{room?.name || 'Workspace'}</span>
                  </div>

                  {/* Root Action Icons */}
                  {role !== 'Viewer' && (
                    <div className="flex items-center gap-1 opacity-0 group-hover/root:opacity-100 transition-opacity mr-2 shrink-0">
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); handleCreateFile(''); }}
                        title="New File"
                      >
                        <span className="material-symbols-outlined text-[15px]">note_add</span>
                      </button>
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); handleCreateFolder(''); }}
                        title="New Folder"
                      >
                        <span className="material-symbols-outlined text-[15px]">create_new_folder</span>
                      </button>
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); showToast('Explorer synced', 'info'); }}
                        title="Refresh Explorer"
                      >
                        <span className="material-symbols-outlined text-[15px]">sync</span>
                      </button>
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); setExpandedFolders(new Set()); }}
                        title="Collapse All"
                      >
                        <span className="material-symbols-outlined text-[15px]">collapse_all</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* File/Folder Tree */}
              {isFilesTreeOpen && (() => {
                const FileIcon = ({ name }) => {
                    if (!name) return <FileCode size={14} className="text-gray-400 shrink-0" />;
                    if (name.endsWith('.js') || name.endsWith('.jsx')) return <span className="text-[#eab308] font-bold text-[10px] w-3.5 text-center shrink-0">JS</span>;
                    if (name.endsWith('.ts') || name.endsWith('.tsx')) return <span className="text-[#3b82f6] font-bold text-[10px] w-3.5 text-center shrink-0">TS</span>;
                    if (name.endsWith('.py')) return <span className="text-[#3b82f6] font-bold text-[10px] w-3.5 text-center shrink-0">PY</span>;
                    if (name.endsWith('.java')) return <span className="text-[#ef4444] font-bold text-[10px] w-3.5 text-center shrink-0">J</span>;
                    if (name.endsWith('.cpp') || name.endsWith('.cc')) return <span className="text-[#a855f7] font-bold text-[10px] w-3.5 text-center shrink-0">C++</span>;
                    if (name.endsWith('.html')) return <span className="text-[#f97316] font-bold text-[10px] w-3.5 text-center shrink-0"><>&lt;/&gt;</></span>;
                    if (name.endsWith('.css')) return <span className="text-[#ec4899] font-bold text-[10px] w-3.5 text-center shrink-0">#</span>;
                    if (name.endsWith('.md')) return <span className="text-[#60a5fa] font-bold text-[10px] w-3.5 text-center shrink-0">M&#8595;</span>;
                    if (name.endsWith('.json')) return <span className="text-[#fef08a] font-bold text-[10px] w-3.5 text-center shrink-0">&#123;&#125;</span>;
                    if (name === '.env') return <Settings size={14} className="text-gray-400 shrink-0" />;
                    return <FileCode size={14} className="text-gray-400 shrink-0" />;
                  };

                const renderTree = (nodes, depth = 0) => (
                    <div className="flex flex-col">
                      {nodes.map((node) => {
                        const indent = depth * 12 + 16;
                        if (node.type === 'folder') {
                          const isOpen = expandedFolders.has(node.path);
                          return (
                            <div key={node.path}>
                              {/* Folder Row */}
                              <div
                                className="flex items-center py-[3px] cursor-pointer text-on-surface-variant hover:text-on-surface hover:bg-[#2a2d2e] group/folder transition-colors"
                                style={{ paddingLeft: `${indent}px`, paddingRight: '8px' }}
                                onClick={() => setExpandedFolders(prev => {
                                  const s = new Set(prev);
                                  if (s.has(node.path)) s.delete(node.path); else s.add(node.path);
                                  return s;
                                })}
                              >
                                <span
                                  className="material-symbols-outlined text-[16px] text-on-surface-muted transition-transform duration-100 shrink-0 mr-1"
                                  style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                >
                                  chevron_right
                                </span>
                                <span className="material-symbols-outlined text-[15px] text-on-surface-muted shrink-0 mr-1.5">
                                  {isOpen ? 'folder_open' : 'folder'}
                                </span>
                                <span className="text-[12.5px] truncate flex-1">{node.name}</span>

                                {/* Folder hover actions */}
                                {role !== 'Viewer' && (
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity ml-auto shrink-0">
                                    <button
                                      className="p-0.5 hover:bg-[#3e3e42] rounded text-on-surface-muted hover:text-on-surface"
                                      onClick={(e) => { e.stopPropagation(); handleCreateFile(node.path); }}
                                      title="New File"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">note_add</span>
                                    </button>
                                    <button
                                      className="p-0.5 hover:bg-[#3e3e42] rounded text-on-surface-muted hover:text-on-surface"
                                      onClick={(e) => { e.stopPropagation(); handleCreateFolder(node.path); }}
                                      title="New Folder"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">create_new_folder</span>
                                    </button>
                                    <button
                                      className="p-0.5 hover:bg-red-500/20 rounded text-on-surface-muted hover:text-red-400"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteFolder(node.path); }}
                                      title="Delete Folder"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">delete</span>
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Inline folder/file creation input shown inside this folder */}
                              {isOpen && isCreatingFolder && createInsideFolder === node.path && (
                                <div
                                  className="flex items-center py-[3px] bg-[#2a2d2e]"
                                  style={{ paddingLeft: `${indent + 28}px`, paddingRight: '8px' }}
                                >
                                  <span className="material-symbols-outlined text-[15px] text-on-surface-muted shrink-0 mr-1.5">folder</span>
                                  <input
                                    id="new-folder-input"
                                    type="text"
                                    className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full"
                                    value={newFolderNameInput}
                                    onChange={(e) => setNewFolderNameInput(e.target.value)}
                                    onKeyDown={handleNewFolderKeyDown}
                                    onBlur={handleCommitNewFolder}
                                    autoFocus
                                  />
                                </div>
                              )}
                              {isOpen && isCreatingFile && createInsideFolder === node.path && (
                                <div
                                  className="flex items-center py-[3px] bg-[#2a2d2e]"
                                  style={{ paddingLeft: `${indent + 28}px`, paddingRight: '8px' }}
                                >
                                  <FileIcon name={newFileNameInput || 'new'} />
                                  <input
                                    id="new-file-input"
                                    type="text"
                                    className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full ml-1.5"
                                    value={newFileNameInput}
                                    onChange={(e) => setNewFileNameInput(e.target.value)}
                                    onKeyDown={handleNewFileKeyDown}
                                    onBlur={handleCommitNewFile}
                                    autoFocus
                                  />
                                </div>
                              )}

                              {/* Children */}
                              {isOpen && renderTree(node.children, depth + 1)}
                            </div>
                          );
                        }

                        // File Row
                        return (
                          <div
                            key={node.path}
                            className={`flex items-center py-[3px] cursor-pointer transition-colors group/file ${
                              activeFile === node.path
                                ? 'bg-[#37373d] text-white'
                                : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2a2d2e]'
                            }`}
                            style={{ paddingLeft: `${indent + 20}px`, paddingRight: '8px' }}
                            onClick={() => {
                              setActiveFile(node.path);
                              if (!openedFiles.includes(node.path)) {
                                setOpenedFiles([...openedFiles, node.path]);
                              }
                            }}
                            onDoubleClick={(e) => handleFileDoubleClick(e, node.path)}
                            onContextMenu={(e) => handleFileDoubleClick(e, node.path)}
                          >
                            <FileIcon name={node.name} />
                            {renamingFileName === node.path ? (
                              <input
                                id="rename-file-input"
                                type="text"
                                className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full ml-1.5"
                                value={renameInputVal}
                                onChange={(e) => setRenameInputVal(e.target.value)}
                                onKeyDown={(e) => handleRenameKeyDown(e, node.path)}
                                onBlur={() => handleCommitRename(node.path)}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="text-[12.5px] truncate flex-1 ml-1.5">{node.name}</span>
                            )}
                            {role !== 'Viewer' && renamingFileName !== node.path && (
                              <button
                                className="ml-auto shrink-0 text-on-surface-muted hover:text-on-surface opacity-0 group-hover/file:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#3e3e42]"
                                onClick={(e) => { e.stopPropagation(); handleFileDoubleClick(e, node.path); }}
                                title="File options"
                              >
                                <span className="material-symbols-outlined text-[14px]">more_horiz</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                  
                  const tree = buildFileTree(files);
                return (
                  <div className="pt-0.5">
                    {/* Root-level inline creation inputs */}
                    {isCreatingFolder && createInsideFolder === '' && (
                        <div className="flex items-center py-[3px] bg-[#2a2d2e]" style={{ paddingLeft: '32px', paddingRight: '8px' }}>
                          <span className="material-symbols-outlined text-[15px] text-on-surface-muted shrink-0 mr-1.5">folder</span>
                          <input
                            id="new-folder-input"
                            type="text"
                            className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full"
                            value={newFolderNameInput}
                            onChange={(e) => setNewFolderNameInput(e.target.value)}
                            onKeyDown={handleNewFolderKeyDown}
                            onBlur={handleCommitNewFolder}
                            autoFocus
                          />
                        </div>
                      )}
                      {isCreatingFile && createInsideFolder === '' && (
                        <div className="flex items-center py-[3px] bg-[#2a2d2e]" style={{ paddingLeft: '32px', paddingRight: '8px' }}>
                          <FileIcon name={newFileNameInput || 'new'} />
                          <input
                            id="new-file-input"
                            type="text"
                            className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full ml-1.5"
                            value={newFileNameInput}
                            onChange={(e) => setNewFileNameInput(e.target.value)}
                            onKeyDown={handleNewFileKeyDown}
                            onBlur={handleCommitNewFile}
                            autoFocus
                          />
                        </div>
                      )}
                      {renderTree(tree)}
                  </div>
                );
              })()}
            </div>

            <div className="p-4 border-t border-outline-subtle mt-auto">
              <button
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border border-accent-blue/30 text-[10px] font-medium text-accent-blue hover:bg-accent-blue/10 transition-colors"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  showToast('Share link copied!', 'success');
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
            {!activeFile ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-surface-panel select-none">
                <img src="/logo.png" className="h-20 object-contain mb-8 opacity-40 filter grayscale" alt="CollabIDE Logo" />
                <h2 className="text-lg font-semibold text-on-surface mb-2">No File Open</h2>
                <p className="text-[9px] text-on-surface-muted max-w-xs text-center mb-6">
                  Select a file from the explorer sidebar, or click the new file button to create one.
                </p>
                <div className="flex flex-col gap-1 w-full max-w-xs">
                  <button 
                    onClick={handleCreateFile}
                    className="flex items-center justify-between px-2 py-1 bg-surface-elevated hover:bg-bg-hover border border-outline rounded-md text-[9px] text-on-surface transition-all"
                  >
                    <span>Create New File</span>
                    <span className="text-[9px] text-on-surface-muted bg-[#252526] px-1.5 py-0.5 rounded">Alt+N</span>
                  </button>
                </div>
              </div>
            ) : (
              <Editor
                height="100%"
                path={activeFile}
                language={
                  activeFile.endsWith('.py')
                    ? 'python'
                    : activeFile.endsWith('.java')
                    ? 'java'
                    : (activeFile.endsWith('.cpp') || activeFile.endsWith('.cc'))
                    ? 'cpp'
                    : activeFile.endsWith('.c')
                    ? 'c'
                    : activeFile.endsWith('.md')
                    ? 'markdown'
                    : 'javascript'
                }
                theme="vs-dark"
                loading="Loading Editor Workspace..."
                onMount={handleEditorDidMount}
                options={{
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  minimap: { enabled: false },
                  smoothScrolling: true,
                  automaticLayout: true,
                  lineNumbersMinChars: 3,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  padding: { top: 12 },
                  readOnly: room?.isClosed || role === 'Viewer' || (editorOnlyMode && role === 'Editor' && !inVoice),
                  contextmenu: (() => {
                    const isReadOnly = room?.isClosed || role === 'Viewer' || (editorOnlyMode && role === 'Editor' && !inVoice);
                    window._collabIdeReadOnly = isReadOnly;
                    return !isReadOnly; // Disable context menu if read only to prevent pasting
                  })(),
                }}
              />
            )}

            {/* View only watermark */}
            {role === 'Viewer' && (
              <div className="absolute bottom-4 left-6 pointer-events-none select-none text-text-muted opacity-30 font-semibold tracking-wider text-[9.5px]">
                VIEW ONLY
              </div>
            )}

            {/* User editing count badge */}
            <div className="absolute bottom-4 right-6 glass-panel px-2 py-1.5 rounded-full flex items-center gap-1 border border-outline/30 shadow-lg z-10">
              <div className="flex -space-x-1.5">
                <div className="w-4 h-4 rounded-full bg-accent-blue border border-surface" />
                <div className="w-4 h-4 rounded-full bg-accent-green border border-surface" />
              </div>
              <span className="text-[9.5px] font-medium text-on-surface-variant">{onlineCount} editing</span>
            </div>
          </div>

          {/* Console / Output area */}
          {consoleOpen && (
             <section 
               className="border-t border-outline flex flex-col bg-surface-panel relative shrink-0"
               style={{ height: `${consoleHeight}px` }}
             >
               <div 
                 className="absolute top-0 left-0 w-full h-[4px] bg-outline-subtle hover:bg-accent-blue cursor-row-resize transition-colors" 
                 onMouseDown={handleConsoleResize}
               />
              <div className="flex items-center justify-between px-2 h-8 border-b border-outline-subtle">
                <div className="flex h-full">
                  <button
                    className={`px-3 text-[9px] font-medium h-full transition-colors ${
                      consoleTab === 'output' ? 'text-accent-blue border-b-[3px] border-accent-blue bg-transparent' : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
                    }`}
                    onClick={() => setConsoleTab('output')}
                  >
                    Output
                  </button>
                  <button
                    className={`px-3 text-[9px] font-medium h-full transition-colors ${
                      consoleTab === 'terminal' ? 'text-accent-blue border-b-[3px] border-accent-blue bg-transparent' : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
                    }`}
                    onClick={() => setConsoleTab('terminal')}
                  >
                    Terminal
                  </button>
                  <button
                    className={`px-3 text-[9px] font-medium h-full transition-colors ${
                      consoleTab === 'problems' ? 'text-accent-blue border-b-[3px] border-accent-blue bg-transparent' : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
                    }`}
                    onClick={() => setConsoleTab('problems')}
                  >
                    Problems
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="w-7 h-7 flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30] rounded transition-colors"
                    onClick={handleCopyOutput}
                    title="Copy Output"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center text-on-surface-variant hover:text-accent-red hover:bg-red-950/30 rounded transition-colors"
                    onClick={handleClearOutput}
                    title="Clear Output"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30] rounded transition-colors"
                    onClick={() => setConsoleOpen(false)}
                    title="Minimize Console"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3 font-code text-[9.5px] overflow-y-auto bg-[#0d0e0f]">
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
          <aside style={{ width: `${rightPanelWidth}px` }} className="h-full bg-surface-panel border-l border-outline-subtle flex flex-col shrink-0 relative">
            <div className="absolute top-0 left-0 w-[4px] h-full bg-transparent hover:bg-accent-blue cursor-col-resize transition-colors z-50 -translate-x-1/2" onMouseDown={handleRightPanelResize} />
            <div className="flex items-center justify-between border-b border-outline-subtle pr-2 bg-surface-panel">
              <div className="flex flex-1">
                <button
                  className={`flex-1 py-1.5 text-[9.5px] font-medium transition-colors ${
                    rightPanelTab === 'participants'
                      ? 'text-accent-blue border-b-[3px] border-accent-blue bg-transparent'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
                  }`}
                  onClick={() => setRightPanelTab('participants')}
                >
                  Participants ({onlineCount})
                </button>
                <button
                  className={`flex-1 py-1.5 text-[9.5px] font-medium transition-colors ${
                    rightPanelTab === 'chat'
                      ? 'text-accent-blue border-b-[3px] border-accent-blue bg-transparent'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
                  }`}
                  onClick={() => setRightPanelTab('chat')}
                >
                  Chat
                </button>
              </div>
              <button
                onClick={() => setRightPanelOpen(false)}
                className="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-elevated transition-colors ml-1"
                title="Collapse Panel"
              >
                <span className="material-symbols-outlined text-[12px]">chevron_right</span>
              </button>
            </div>

            {rightPanelTab === 'participants' && (
              <div className="p-3 flex flex-col gap-1.5 overflow-y-auto flex-1 select-none">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setIsOnlineListOpen(!isOnlineListOpen)}
                    className="flex items-center gap-1 text-[9px] font-semibold text-on-surface-muted uppercase tracking-wider hover:text-on-surface transition-colors"
                  >
                    <span
                      className="material-symbols-outlined text-[12px] transition-transform duration-200"
                      style={{ transform: isOnlineListOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                    >
                      expand_more
                    </span>
                    <span>Online ({onlineCount})</span>
                  </button>
                  {isUserLeader && (
                    <div className="flex gap-2 text-[9px] font-medium">
                      <button onClick={handleMuteAll} className="px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors">Mute all</button>
                      <button onClick={toggleEditorOnlyVoice} className="px-2 py-1 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors">
                        {editorOnlyMode ? 'Unlock Voice' : 'Lock Voice'}
                      </button>
                    </div>
                  )}
                </div>

                {isOnlineListOpen && (
                  <div className="flex flex-col gap-1">

                {/* Local user entry */}
                <div className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-[#2b2d30]">
                  <div className="relative">
                    <div
                      className="w-8 h-8 rounded-full shrink-0 bg-accent-blue flex items-center justify-center text-white text-[9px] font-bold"
                      style={{ backgroundColor: getUserColor(user.id || user._id, user.displayName) }}
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
                      <span className="text-[9px] px-1.5 py-0.5 bg-[#3d3000] text-[#f9ab00] rounded-sm font-medium uppercase">
                        {role}
                      </span>
                    </div>
                    <span className="text-[9.5px] text-accent-green">
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
                      <div key={p.id} className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-surface-elevated group">
                        <div className="relative">
                          <div
                            className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-[9px] font-bold"
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
                                className="bg-[#1e1e2e] border border-outline-subtle rounded text-[9px] text-on-surface px-1 py-0.5 outline-none cursor-pointer focus:border-accent-blue"
                              >
                                <option value="Viewer">Viewer</option>
                                <option value="Editor">Editor</option>
                                {role === 'Owner' && <option value="Room Leader">Room Leader</option>}
                              </select>
                            ) : (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-medium uppercase ${getRoleBadgeClass(p.role)}`}>
                                {p.role || 'Viewer'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-[9.5px] text-on-surface-muted">
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
              </div>
            )}

            {rightPanelTab === 'chat' && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div
                  id="chat-msg-container"
                  className="flex-1 p-4 overflow-y-auto flex flex-col gap-1 bg-[#121414]"
                >
                  {chatMessages.map((msg, idx) => {
                    const isMine = msg.userId === (user.id || user._id);
                    const msgColor = getUserColor(msg.userId, msg.displayName);
                    return (
                      <div key={idx} className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <div
                            className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-white text-[9px] font-bold"
                            style={{ backgroundColor: msgColor }}
                          >
                            {msg.displayName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[9px] font-semibold" style={{ color: msgColor }}>
                            {msg.displayName}
                          </span>
                          <span className="text-[9px] text-on-surface-muted ml-auto">{msg.time}</span>
                        </div>
                        <div className="pl-8 text-sm text-text-primary whitespace-pre-wrap">{msg.text}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 border-t border-outline-subtle bg-surface-panel flex items-center gap-1">
                  <input
                    type="text"
                    className="flex-1 min-w-0 bg-surface border border-outline rounded-md px-2 py-1.5 text-sm text-on-surface focus:border-accent-blue focus:ring-0 outline-none transition-colors"
                    placeholder="Type a message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  />
                  <button
                    onClick={handleSendChat}
                    className="p-1.5 bg-accent-blue text-white rounded-md hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>



      {/* Status Bar */}
      <footer className="h-[22px] bg-accent-blue text-white px-2 flex items-center justify-between text-[9.5px] shrink-0 z-40">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-green shadow-[0_0_4px_rgba(30,142,62,0.6)]" />
            <span>{syncStatus} (v2)</span>
          </div>
          <div className="h-3 w-px bg-white/20" />
          <span>{onlineCount} online</span>
        </div>
        <div className="flex items-center gap-1">
          <span>{activeFile.endsWith('.js') ? 'JavaScript' : 'Python'}</span>
          <div className="h-3 w-px bg-white/20" />
          <span className="cursor-pointer hover:underline" onClick={() => navigator.clipboard.writeText(roomUuid)}>
            Room: {roomUuid.slice(0, 8)}
          </span>
          <div className="h-3 w-px bg-white/20" />
          <span>UTF-8</span>
        </div>
      </footer>

            {/* Floating Voice Dock (Google Meet Style) */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center glass-panel bg-surface/90 h-[52px] rounded-full border border-outline/20 shadow-2xl z-50 px-3">
        
        {inVoice ? (
          <>
            <div className="relative flex items-center">
              <button
                onClick={toggleMuteSelf}
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors border ${
                  isMuted 
                    ? 'bg-accent-red text-white border-transparent hover:opacity-90' 
                    : 'bg-surface-variant text-on-surface hover:bg-outline-subtle'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                <span className="material-symbols-outlined text-[20px]">{isMuted ? 'mic_off' : 'mic'}</span>
              </button>
              <button
                onClick={() => setShowVoiceSettings(!showVoiceSettings)}
                className="w-6 h-10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">expand_less</span>
              </button>

              <VoiceDeviceMenu
                isOpen={showVoiceSettings}
                onClose={() => setShowVoiceSettings(false)}
                selectedMicId={selectedMicId}
                selectedSpeakerId={selectedSpeakerId}
                onUpdateDevices={updateDevices}
              />
            </div>

            <div className="w-px h-6 bg-outline mx-2" />

            {isUserLeader && (
              <div className="flex items-center gap-1 mr-1">
                <button 
                  onClick={handleMuteAll} 
                  className="px-3 h-9 text-xs font-medium text-accent-red hover:bg-accent-red/10 rounded-md transition-colors"
                >
                  Mute all
                </button>
                <button 
                  onClick={toggleEditorOnlyVoice} 
                  className="px-3 h-9 text-xs font-medium text-accent-blue hover:bg-accent-blue/10 rounded-md transition-colors"
                >
                  {editorOnlyMode ? 'Unlock voice' : 'Lock voice'}
                </button>
              </div>
            )}

            <button
              onClick={leaveVoice}
              className="px-5 h-10 flex items-center justify-center rounded-full bg-accent-red text-white text-sm font-medium hover:opacity-90 transition-colors gap-2 ml-1"
            >
              <span className="material-symbols-outlined text-[18px]">call_end</span>
              Leave
            </button>
          </>
        ) : (
          <div className="relative flex items-center h-10">
            <button
              onClick={joinVoice}
              className="px-5 h-10 flex items-center justify-center rounded-full bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 transition-colors gap-2"
              title="Connect Voice"
            >
              <span className="material-symbols-outlined text-[18px]">call</span>
              Join Voice
            </button>
            <button
              onClick={() => setShowVoiceSettings(!showVoiceSettings)}
              className="w-8 h-10 ml-1 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">expand_less</span>
            </button>
            
            <VoiceDeviceMenu
              isOpen={showVoiceSettings}
              onClose={() => setShowVoiceSettings(false)}
              selectedMicId={selectedMicId}
              selectedSpeakerId={selectedSpeakerId}
              onUpdateDevices={updateDevices}
            />
          </div>
        )}
      </div>

{/* Admin lock overlay notifications */}
      {mutedByLeaderMsg && (
        <div className="fixed bottom-24 left-6 z-50 bg-[#1b1c1c] border-l-4 border-accent-red px-2 py-1.5 rounded-lg shadow-2xl max-w-sm">
          <div className="flex items-center gap-1 text-accent-red font-semibold text-sm">
            <MicOff size={16} /> Muted by Room Leader
          </div>
          <div className="text-[9px] text-on-surface-variant mt-1">{mutedByLeaderMsg}</div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-[slideUp_0.3s_ease-out]"
          style={{ animation: 'slideUp 0.3s ease-out' }}
        >
          <div className={`flex items-center gap-1.5 px-2 py-2.5 rounded-lg shadow-2xl border text-sm font-medium backdrop-blur-md ${
            toastMessage.type === 'success'
              ? 'bg-[#0d2818] border-green-600/40 text-green-300'
              : toastMessage.type === 'error'
              ? 'bg-[#2a0f0f] border-red-600/40 text-red-300'
              : toastMessage.type === 'warning'
              ? 'bg-[#2a2000] border-yellow-600/40 text-yellow-300'
              : 'bg-[#0d1b2a] border-blue-600/40 text-blue-300'
          }`}>
            <span className="material-symbols-outlined text-[12px]">
              {toastMessage.type === 'success' ? 'check_circle' : toastMessage.type === 'error' ? 'error' : toastMessage.type === 'warning' ? 'warning' : 'info'}
            </span>
            <span>{toastMessage.text}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
            >
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Room Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-surface-panel border border-outline-subtle w-full max-w-sm rounded-xl overflow-hidden shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-outline-subtle flex items-center justify-between">
              <h2 className="text-text-lg font-bold text-on-surface">Room Settings</h2>
              <button 
                className="p-1 rounded-md text-on-surface-muted hover:bg-surface-elevated hover:text-on-surface transition-colors"
                onClick={() => setShowSettingsModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-text-sm font-semibold text-on-surface">{room?.isClosed ? 'Re-open Room' : 'Close Room'}</h3>
                <p className="text-[11px] text-on-surface-muted">
                  {room?.isClosed 
                    ? 'Re-opening the room will restore write access to editors and allow voice collaboration.' 
                    : 'Closing the room will lock the editor for all participants and disconnect active voice sessions.'}
                </p>
                <button
                  className="mt-2 px-4 py-2 bg-surface-elevated border border-outline hover:border-accent-blue rounded-md text-text-sm font-medium text-on-surface transition-colors"
                  onClick={async () => {
                    try {
                      if (room?.isClosed) {
                        await openRoom(roomUuid);
                      } else {
                        await closeRoom(roomUuid);
                      }
                      setShowSettingsModal(false);
                    } catch (err) {
                      setSettingsError(err.message);
                    }
                  }}
                >
                  {room?.isClosed ? 'Re-open Room' : 'Close Room'}
                </button>
              </div>

              {settingsError && (
                <div className="bg-red-900/50 border border-red-500/50 text-red-200 px-3 py-2 rounded-md mb-2 flex items-center justify-between text-[11px]">
                  <span>{settingsError}</span>
                  <button onClick={() => setSettingsError('')} className="text-red-300 hover:text-white">✕</button>
                </div>
              )}
              
              {!showDeleteConfirm ? (
                <>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-text-sm font-semibold text-on-surface">{room?.isClosed ? 'Re-open Room' : 'Close Room'}</h3>
                    <p className="text-[11px] text-on-surface-muted">
                      {room?.isClosed 
                        ? 'Re-opening the room will restore write access to editors and allow voice collaboration.' 
                        : 'Closing the room will lock the editor for all participants and disconnect active voice sessions.'}
                    </p>
                    <button
                      className="mt-2 px-4 py-2 bg-surface-elevated border border-outline hover:border-accent-blue rounded-md text-text-sm font-medium text-on-surface transition-colors"
                      onClick={async () => {
                        try {
                          if (room?.isClosed) {
                            await openRoom(roomUuid);
                          } else {
                            await closeRoom(roomUuid);
                          }
                          setShowSettingsModal(false);
                        } catch (err) {
                          setSettingsError(err.message);
                        }
                      }}
                    >
                      {room?.isClosed ? 'Re-open Room' : 'Close Room'}
                    </button>
                  </div>

                  <div className="h-px w-full bg-outline-subtle my-2" />

                  <div className="flex flex-col gap-1">
                    <h3 className="text-text-sm font-semibold text-red-500">Danger Zone</h3>
                    <p className="text-[11px] text-on-surface-muted">
                      Permanently delete this room, its code, and execution history.
                    </p>
                    <button
                      className="mt-2 px-4 py-2 bg-red-950/30 border border-red-900/50 hover:bg-red-900/40 rounded-md text-text-sm font-medium text-red-400 transition-colors flex items-center justify-center gap-2"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      <Trash2 size={16} /> Delete Room
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-red-500 mb-1">
                    <Trash2 size={20} />
                    <h3 className="text-text-base font-bold">Are you absolutely sure?</h3>
                  </div>
                  <p className="text-[12px] text-on-surface-muted leading-relaxed">
                    This will permanently delete the room, disconnecting all participants and wiping all code history. This action cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      className="px-4 py-2 rounded-md text-text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-elevated transition-colors"
                      onClick={() => { setShowDeleteConfirm(false); setSettingsError(''); }}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-text-sm font-medium transition-colors"
                      onClick={async () => {
                        try {
                          await deleteRoom(roomUuid);
                          setShowSettingsModal(false);
                        } catch (err) {
                          setSettingsError(err.message);
                        }
                      }}
                    >
                      Yes, delete it
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Room Deleted Modal */}
      {showRoomDeletedModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
          <div className="bg-[#1f2020] border border-[#404751] w-full max-w-sm rounded-xl overflow-hidden shadow-2xl flex flex-col text-center p-6">
            <div className="w-12 h-12 rounded-full bg-red-950/30 flex items-center justify-center text-red-500 mx-auto mb-4">
              <span className="material-symbols-outlined text-[24px]">warning</span>
            </div>
            <h2 className="text-text-lg font-bold text-on-surface mb-2">Room Deleted</h2>
            <p className="text-text-sm text-text-muted leading-relaxed mb-6">
              This room has been permanently deleted by the owner. You will now be redirected to the dashboard.
            </p>
            <button
              className="w-full px-4 py-2 bg-accent-blue hover:bg-blue-600 text-white rounded-md text-text-sm font-medium transition-colors"
              onClick={() => {
                setShowRoomDeletedModal(false);
                onBack();
              }}
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
