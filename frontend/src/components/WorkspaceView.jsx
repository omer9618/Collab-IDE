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

export default function WorkspaceView({ roomUuid, user, onBack }) {
  const [room, setRoom] = useState(null);
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
  const roomRef = useRef(null);
  const isCommittingFileRef = useRef(false);
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

    // Connect directly to public backend for WebSocket
    const wsUrl = 'wss://collabide-backend-avau.onrender.com';

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

      // Connect directly to public backend for Voice
      const backendUrl = 'https://collabide-backend-avau.onrender.com';

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
        showToast(message, 'error');
      });

    } catch (err) {
      showToast(`Could not access microphone: ${err.message}`, 'error');
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
      showToast(`Failed to change role: ${err.message}`, 'error');
    }
  };

  const isUserLeader = role === 'Owner' || role === 'Room Leader';

  return (
    <div className="bg-surface text-on-surface font-ui overflow-hidden h-screen flex flex-col select-none">
      {/* Top Bar (56px) */}
      <header className="h-[56px] shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-3 z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center cursor-pointer" onClick={() => { leaveVoice(); onBack(); }}>
            <img src="/logo.png" className="h-12 object-contain" alt="CollabIDE Logo" />
          </div>
          <div className="h-4 w-px bg-outline mx-1" />
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              showToast('Invite link copied!', 'success');
            }}
            className="text-sm text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1 group"
          >
            {room?.name || 'Loading room...'}
            <span className="material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-100 transition-opacity">content_copy</span>
          </button>
          
          {/* File tabs inside Top Bar */}
          <div className="flex items-center gap-px ml-2 overflow-x-auto no-scrollbar">
            {openedFiles.map((fileName) => (
              <div
                key={fileName}
                className={`px-3 h-[56px] text-sm flex items-center gap-2 border-b-2 transition-all group/tab ${
                  activeFile === fileName
                    ? 'text-on-surface bg-surface-elevated border-accent-blue'
                    : 'text-on-surface-variant border-transparent hover:bg-surface-elevated'
                }`}
              >
                <button
                  className="flex items-center gap-2 h-full outline-none focus:outline-none"
                  onClick={() => setActiveFile(fileName)}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
                  <span title={fileName}>{fileName.split('/').pop()}</span>
                </button>
                <button
                  className="text-on-surface-variant hover:text-on-surface rounded p-0.5 ml-1 flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseFile(fileName);
                  }}
                  title="Close Tab"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunCode}
            disabled={isRunning || role === 'Viewer' || !activeFile || activeFile.endsWith('.md')}
            className={`flex items-center gap-1.5 px-3 py-1 text-white text-sm font-medium rounded-md transition-all shadow ${
              (isRunning || role === 'Viewer' || !activeFile || activeFile.endsWith('.md'))
                ? 'bg-gray-700 opacity-50 cursor-not-allowed'
                : 'bg-accent-blue hover:opacity-90'
            }`}
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

          <div className="text-sm text-on-surface-variant bg-surface-elevated px-2.5 py-1 rounded border border-outline font-medium">
            {!activeFile
              ? 'No File'
              : activeFile.endsWith('.py')
              ? 'Python'
              : activeFile.endsWith('.java')
              ? 'Java'
              : (activeFile.endsWith('.cpp') || activeFile.endsWith('.cc'))
              ? 'C++'
              : activeFile.endsWith('.c')
              ? 'C'
              : activeFile.endsWith('.md')
              ? 'Markdown'
              : 'JavaScript'}
          </div>

          <button
            className={`flex items-center gap-1.5 px-2 py-1 text-sm rounded transition-colors ${
              rightPanelOpen && rightPanelTab === 'participants'
                ? 'bg-surface-elevated text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-elevated'
            }`}
            onClick={() => {
              if (rightPanelOpen && rightPanelTab === 'participants') {
                setRightPanelOpen(false);
              } else {
                setRightPanelOpen(true);
                setRightPanelTab('participants');
              }
            }}
            title={rightPanelOpen && rightPanelTab === 'participants' ? 'Collapse Participants' : 'Expand Participants'}
          >
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            <span>{onlineCount} online</span>
          </button>

          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={`p-1.5 rounded transition-colors flex items-center justify-center ${
              rightPanelOpen ? 'bg-surface-elevated text-accent-blue' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-elevated'
            }`}
            title={rightPanelOpen ? 'Collapse Panel' : 'Expand Panel'}
          >
            <span className="material-symbols-outlined text-[18px]">
              {rightPanelOpen ? 'dock_to_left' : 'view_sidebar'}
            </span>
          </button>

          <button
            className="w-7 h-7 rounded-full bg-accent-blue flex items-center justify-center text-white text-[10px] font-bold border border-white/20"
            style={{ backgroundColor: getUserColor(user.id || user._id, user.displayName) }}
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
          <nav className="w-[260px] h-full bg-surface-panel border-r border-outline-subtle flex flex-col shrink-0 select-none">
            {/* Explorer Top Header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-outline-subtle">
              <span className="text-[11px] font-semibold text-on-surface uppercase tracking-wider">Explorer</span>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {/* Workspace Root Row */}
              <div className="px-3 py-2 flex items-center justify-between group/root cursor-pointer hover:bg-surface-elevated/50 text-xs font-semibold text-on-surface">
                <div
                  className="flex items-center gap-1.5 min-w-0 flex-1"
                  onClick={() => setIsFilesTreeOpen(!isFilesTreeOpen)}
                >
                  <span
                    className="material-symbols-outlined text-[18px] text-on-surface-muted transition-transform duration-200"
                    style={{ transform: isFilesTreeOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  >
                    expand_more
                  </span>
                  <span className="material-symbols-outlined text-[18px] text-on-surface-muted">folder_open</span>
                  <span className="truncate">{room?.name || 'Workspace'}</span>
                </div>

                {/* Root Action Icons */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover/root:opacity-100 transition-opacity">
                  <button
                    className="p-1 text-on-surface-muted hover:text-on-surface hover:bg-surface-elevated rounded"
                    onClick={(e) => { e.stopPropagation(); handleCreateFile(''); }}
                    title="New File"
                  >
                    <span className="material-symbols-outlined text-[17px]">note_add</span>
                  </button>
                  <button
                    className="p-1 text-on-surface-muted hover:text-on-surface hover:bg-surface-elevated rounded"
                    onClick={(e) => { e.stopPropagation(); handleCreateFolder(''); }}
                    title="New Folder"
                  >
                    <span className="material-symbols-outlined text-[17px]">create_new_folder</span>
                  </button>
                  <button
                    className="p-1 text-on-surface-muted hover:text-on-surface hover:bg-surface-elevated rounded"
                    onClick={(e) => { e.stopPropagation(); showToast('Explorer synced', 'info'); }}
                    title="Refresh Explorer"
                  >
                    <span className="material-symbols-outlined text-[17px]">sync</span>
                  </button>
                </div>
              </div>

              {/* File/Folder Tree */}
              {isFilesTreeOpen && (() => {
                const fileColorDot = (name) => {
                  if (name.endsWith('.js') || name.endsWith('.jsx')) return 'bg-yellow-400';
                  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'bg-blue-300';
                  if (name.endsWith('.py')) return 'bg-blue-400';
                  if (name.endsWith('.java')) return 'bg-red-400';
                  if (name.endsWith('.cpp') || name.endsWith('.cc')) return 'bg-purple-400';
                  if (name.endsWith('.c')) return 'bg-teal-400';
                  if (name.endsWith('.html')) return 'bg-orange-400';
                  if (name.endsWith('.css')) return 'bg-pink-400';
                  if (name.endsWith('.md')) return 'bg-gray-300';
                  if (name.endsWith('.json')) return 'bg-yellow-200';
                  return 'bg-gray-500';
                };

                const renderTree = (nodes, depth = 0) => (
                  <div>
                    {nodes.map((node) => {
                      const indent = depth * 12 + 12;
                      if (node.type === 'folder') {
                        const isOpen = expandedFolders.has(node.path);
                        return (
                          <div key={node.path}>
                            {/* Folder Row */}
                            <div
                              className="flex items-center gap-2 py-1.5 cursor-pointer text-on-surface-variant hover:bg-bg-hover group/folder transition-all"
                              style={{ paddingLeft: `${indent}px`, paddingRight: '8px' }}
                              onClick={() => setExpandedFolders(prev => {
                                const s = new Set(prev);
                                if (s.has(node.path)) s.delete(node.path); else s.add(node.path);
                                return s;
                              })}
                            >
                              <span
                                className="material-symbols-outlined text-[17px] text-on-surface-muted transition-transform duration-150 shrink-0"
                                style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                              >
                                expand_more
                              </span>
                              <span className="material-symbols-outlined text-[17px] text-yellow-500/80 shrink-0">
                                {isOpen ? 'folder_open' : 'folder'}
                              </span>
                              <span className="text-sm truncate flex-1">{node.name}</span>

                              {/* Folder hover actions */}
                              {role !== 'Viewer' && (
                                <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity ml-auto shrink-0">
                                  <button
                                    className="p-0.5 hover:bg-surface-elevated rounded text-on-surface-muted hover:text-on-surface"
                                    onClick={(e) => { e.stopPropagation(); handleCreateFile(node.path); }}
                                    title="New File inside folder"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">note_add</span>
                                  </button>
                                  <button
                                    className="p-1 hover:bg-surface-elevated rounded text-on-surface-muted hover:text-on-surface"
                                    onClick={(e) => { e.stopPropagation(); handleCreateFolder(node.path); }}
                                    title="New Subfolder"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
                                  </button>
                                  <button
                                    className="p-1 hover:bg-red-500/20 rounded text-on-surface-muted hover:text-red-400"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteFolder(node.path); }}
                                    title="Delete Folder"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Inline folder/file creation input shown inside this folder */}
                            {isOpen && isCreatingFolder && createInsideFolder === node.path && (
                              <div
                                className="flex items-center gap-2 py-1.5 bg-surface-elevated"
                                style={{ paddingLeft: `${indent + 24}px`, paddingRight: '8px' }}
                              >
                                <span className="material-symbols-outlined text-[15px] text-yellow-500/80 shrink-0">folder</span>
                                <input
                                  id="new-folder-input"
                                  type="text"
                                  className="bg-[#121414] border border-accent-blue rounded text-xs px-1.5 py-0.5 text-on-surface outline-none w-full font-mono"
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
                                className="flex items-center gap-2 py-1.5 bg-surface-elevated"
                                style={{ paddingLeft: `${indent + 24}px`, paddingRight: '8px' }}
                              >
                                <span className={`w-2 h-2 rounded-full shrink-0 bg-gray-500`} />
                                <input
                                  id="new-file-input"
                                  type="text"
                                  className="bg-[#121414] border border-accent-blue rounded text-xs px-1.5 py-0.5 text-on-surface outline-none w-full font-mono"
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
                          className={`flex items-center gap-2.5 py-1.5 cursor-pointer transition-all group/file ${
                            activeFile === node.path
                              ? 'bg-surface-elevated border-l-2 border-accent-blue text-on-surface'
                              : 'text-on-surface-variant hover:bg-bg-hover'
                          }`}
                          style={{ paddingLeft: `${indent}px`, paddingRight: '8px' }}
                          onClick={() => {
                            setActiveFile(node.path);
                            if (!openedFiles.includes(node.path)) {
                              setOpenedFiles([...openedFiles, node.path]);
                            }
                          }}
                          onDoubleClick={(e) => handleFileDoubleClick(e, node.path)}
                          onContextMenu={(e) => handleFileDoubleClick(e, node.path)}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${fileColorDot(node.name)}`} />
                          {renamingFileName === node.path ? (
                            <input
                              id="rename-file-input"
                              type="text"
                              className="bg-[#121414] border border-accent-blue rounded text-xs px-1.5 py-0.5 text-on-surface outline-none w-full font-mono"
                              value={renameInputVal}
                              onChange={(e) => setRenameInputVal(e.target.value)}
                              onKeyDown={(e) => handleRenameKeyDown(e, node.path)}
                              onBlur={() => handleCommitRename(node.path)}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className="text-sm truncate flex-1">{node.name}</span>
                          )}
                          {role !== 'Viewer' && renamingFileName !== node.path && (
                            <button
                              className="ml-auto shrink-0 text-on-surface-variant hover:text-on-surface opacity-0 group-hover/file:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#2a2b2b]"
                              onClick={(e) => { e.stopPropagation(); handleFileDoubleClick(e, node.path); }}
                              title="File options"
                            >
                              <span className="material-symbols-outlined text-[18px]">more_horiz</span>
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
                      <div className="flex items-center gap-2 py-1.5 bg-surface-elevated mx-2 rounded mb-1" style={{ paddingLeft: '16px', paddingRight: '8px' }}>
                        <span className="material-symbols-outlined text-[15px] text-yellow-500/80 shrink-0">folder</span>
                        <input
                          id="new-folder-input"
                          type="text"
                          className="bg-[#121414] border border-accent-blue rounded text-xs px-1.5 py-0.5 text-on-surface outline-none w-full font-mono"
                          value={newFolderNameInput}
                          onChange={(e) => setNewFolderNameInput(e.target.value)}
                          onKeyDown={handleNewFolderKeyDown}
                          onBlur={handleCommitNewFolder}
                          autoFocus
                        />
                      </div>
                    )}
                    {isCreatingFile && createInsideFolder === '' && (
                      <div className="flex items-center gap-2 py-1.5 bg-surface-elevated mx-2 rounded mb-1" style={{ paddingLeft: '16px', paddingRight: '8px' }}>
                        <span className="w-2 h-2 rounded-full bg-gray-500 shrink-0" />
                        <input
                          id="new-file-input"
                          type="text"
                          className="bg-[#121414] border border-accent-blue rounded text-xs px-1.5 py-0.5 text-on-surface outline-none w-full font-mono"
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
                className="w-full text-left text-[13px] text-accent-blue hover:underline flex items-center gap-1"
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
                <p className="text-xs text-on-surface-muted max-w-xs text-center mb-6">
                  Select a file from the explorer sidebar, or click the new file button to create one.
                </p>
                <div className="flex flex-col gap-2 w-full max-w-xs">
                  <button 
                    onClick={handleCreateFile}
                    className="flex items-center justify-between px-4 py-2 bg-surface-elevated hover:bg-bg-hover border border-outline rounded-md text-xs text-on-surface transition-all"
                  >
                    <span>Create New File</span>
                    <span className="text-[10px] text-on-surface-muted bg-[#252526] px-1.5 py-0.5 rounded">Alt+N</span>
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
                  readOnly: false, // Must be false so y-monaco can apply edits!
                  contextmenu: (() => {
                    const isReadOnly = role === 'Viewer' || (editorOnlyMode && role === 'Editor' && !inVoice);
                    window._collabIdeReadOnly = isReadOnly;
                    return !isReadOnly; // Disable context menu if read only to prevent pasting
                  })(),
                }}
              />
            )}

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
             <section 
               className="border-t border-outline flex flex-col bg-surface-panel relative shrink-0"
               style={{ height: `${consoleHeight}px` }}
             >
               <div 
                 className="absolute top-0 left-0 w-full h-[4px] bg-outline-subtle hover:bg-accent-blue cursor-row-resize transition-colors" 
                 onMouseDown={handleConsoleResize}
               />
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
                <div className="flex items-center gap-0.5">
                  <button
                    className="w-7 h-7 flex items-center justify-center text-on-surface-variant hover:text-on-surface rounded transition-colors"
                    onClick={handleCopyOutput}
                    title="Copy Output"
                  >
                    <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center text-on-surface-variant hover:text-on-surface rounded transition-colors"
                    onClick={handleClearOutput}
                    title="Clear Output"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center text-on-surface-variant hover:text-on-surface rounded transition-colors"
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
            <div className="flex items-center justify-between border-b border-outline-subtle pr-2 bg-surface-panel">
              <div className="flex flex-1">
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
              <button
                onClick={() => setRightPanelOpen(false)}
                className="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-elevated transition-colors ml-1"
                title="Collapse Panel"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>

            {rightPanelTab === 'participants' && (
              <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1 select-none">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setIsOnlineListOpen(!isOnlineListOpen)}
                    className="flex items-center gap-1 text-xs font-semibold text-on-surface-muted uppercase tracking-wider hover:text-on-surface transition-colors"
                  >
                    <span
                      className="material-symbols-outlined text-[16px] transition-transform duration-200"
                      style={{ transform: isOnlineListOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                    >
                      expand_more
                    </span>
                    <span>Online ({onlineCount})</span>
                  </button>
                  {isUserLeader && (
                    <div className="flex gap-2 text-[11px]">
                      <button onClick={handleMuteAll} className="text-accent-red hover:underline">Mute all</button>
                      <button onClick={toggleEditorOnlyVoice} className="text-accent-blue hover:underline">
                        {editorOnlyMode ? 'Unlock Voice' : 'Lock Voice'}
                      </button>
                    </div>
                  )}
                </div>

                {isOnlineListOpen && (
                  <div className="flex flex-col gap-2">

                {/* Local user entry */}
                <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-elevated">
                  <div className="relative">
                    <div
                      className="w-8 h-8 rounded-full bg-accent-blue flex items-center justify-center text-white text-xs font-bold"
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
                    const msgColor = getUserColor(msg.userId, msg.displayName);
                    return (
                      <div key={idx} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                            style={{ backgroundColor: msgColor }}
                          >
                            {msg.displayName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-semibold" style={{ color: msgColor }}>
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
            <span>{syncStatus} (v2)</span>
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

      {/* Floating File Context Menu (VS Code style) */}
      {activeFileMenu && (
        <>
          <div 
            className="fixed inset-0 z-50 cursor-default" 
            onClick={() => setActiveFileMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setActiveFileMenu(null); }}
          />
          <div 
            className="fixed bg-[#1b1c1c] border border-[#2b2b2b] rounded-md shadow-2xl py-1 z-[60] w-36 text-xs text-on-surface-variant font-sans select-none"
            style={{ 
              left: `${Math.min(window.innerWidth - 150, activeFileMenu.x)}px`, 
              top: `${Math.min(window.innerHeight - 100, activeFileMenu.y)}px` 
            }}
          >
            <button 
              className="w-full text-left px-3 py-2 hover:bg-[#2a2b2b] hover:text-on-surface flex items-center gap-2 transition-colors"
              onClick={() => {
                const target = activeFileMenu.fileName;
                setActiveFileMenu(null);
                handleRenameFile(target);
              }}
            >
              <span className="material-symbols-outlined text-[15px]">edit</span>
              <span>Rename...</span>
            </button>
            <button 
              className="w-full text-left px-3 py-2 hover:bg-accent-red/20 hover:text-accent-red text-accent-red flex items-center gap-2 transition-colors border-t border-[#2b2b2b]"
              onClick={() => {
                const target = activeFileMenu.fileName;
                setActiveFileMenu(null);
                handleDeleteFile(target);
              }}
            >
              <span className="material-symbols-outlined text-[15px]">delete</span>
              <span>Delete</span>
            </button>
          </div>
        </>
      )}

      {/* Delete File Confirmation Modal */}
      {deleteConfirmFile && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center backdrop-blur-sm">
          <div className="w-full max-w-[400px] bg-[#1b1c1c] border border-border-default rounded-radius-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-[#2b2b2b] pb-3">
              <h3 className="text-text-base font-semibold text-on-surface">
                {isLastFileWarning ? 'Cannot Delete' : 'Confirm Delete'}
              </h3>
              <button onClick={() => { setDeleteConfirmFile(null); setIsLastFileWarning(false); }} className="text-text-muted hover:text-text-primary">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <p className="text-text-secondary text-text-sm leading-relaxed">
              {isLastFileWarning
                ? 'Workspace must contain at least one file. You cannot delete the last remaining file.'
                : <>Are you sure you want to delete <span className="font-semibold text-on-surface">{deleteConfirmFile}</span>? This action cannot be undone.</>
              }
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#2b2b2b]">
              {isLastFileWarning ? (
                <button
                  type="button"
                  onClick={() => { setDeleteConfirmFile(null); setIsLastFileWarning(false); }}
                  className="px-4 py-1.5 bg-accent-blue text-white rounded-md text-text-sm hover:opacity-90 transition-colors"
                >
                  Got it
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setDeleteConfirmFile(null); setIsLastFileWarning(false); }}
                    className="px-4 py-1.5 border border-[#404751] text-on-surface rounded-md text-text-sm hover:bg-[#252626]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    className="px-4 py-1.5 bg-accent-red text-white rounded-md text-text-sm hover:opacity-90 transition-colors"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin lock overlay notifications */}
      {mutedByLeaderMsg && (
        <div className="fixed bottom-24 left-6 z-50 bg-[#1b1c1c] border-l-4 border-accent-red px-4 py-3 rounded-lg shadow-2xl max-w-sm">
          <div className="flex items-center gap-2 text-accent-red font-semibold text-sm">
            <MicOff size={16} /> Muted by Room Leader
          </div>
          <div className="text-xs text-on-surface-variant mt-1">{mutedByLeaderMsg}</div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-[slideUp_0.3s_ease-out]"
          style={{ animation: 'slideUp 0.3s ease-out' }}
        >
          <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-2xl border text-sm font-medium backdrop-blur-md ${
            toastMessage.type === 'success'
              ? 'bg-[#0d2818] border-green-600/40 text-green-300'
              : toastMessage.type === 'error'
              ? 'bg-[#2a0f0f] border-red-600/40 text-red-300'
              : toastMessage.type === 'warning'
              ? 'bg-[#2a2000] border-yellow-600/40 text-yellow-300'
              : 'bg-[#0d1b2a] border-blue-600/40 text-blue-300'
          }`}>
            <span className="material-symbols-outlined text-[18px]">
              {toastMessage.type === 'success' ? 'check_circle' : toastMessage.type === 'error' ? 'error' : toastMessage.type === 'warning' ? 'warning' : 'info'}
            </span>
            <span>{toastMessage.text}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
