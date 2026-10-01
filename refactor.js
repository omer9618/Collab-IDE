const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

// 1. Add imports
code = code.replace(
  "import {",
  "import { useVoiceRoom } from '../hooks/useVoiceRoom';\nimport VoiceSettingsModal from './VoiceSettingsModal';\nimport {"
);

// 2. Remove states
code = code.replace(
  /\/\/ Voice channel states[\s\S]*?\/\/ Refs for Yjs and peer connections/,
  "// Refs for Yjs and peer connections"
);
code = code.replace(
  /const voiceSocketRef = useRef\(null\);\n  const peerConnectionsRef = useRef\(new Map\(\)\); \/\/ socketId -> RTCPeerConnection\n/,
  ""
);
code = code.replace(
  /const audioElementsRef = useRef\(new Map\(\)\); \/\/ socketId -> HTMLAudioElement\n/,
  ""
);

// 3. Inject hook
code = code.replace(
  "// REST details refresh",
  `const [showVoiceSettings, setShowVoiceSettings] = useState(false);
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

  // REST details refresh`
);

// 4. Remove WebRTC logic block
code = code.replace(
  /\/\/ "?"?"? WebRTC VOICE SIGNALLING "?"?"?[\s\S]*?(return \()/m,
  "$1"
);
// Try fallback regex if emojis were weird
code = code.replace(
  /\/\/ .*WebRTC VOICE SIGNALLING.*[\s\S]*?(return \()/m,
  "$1"
);

// 5. Add Voice Settings Modal rendering at the end of the return
code = code.replace(
  /<\/div>\s*$/m,
  `
      <VoiceSettingsModal
        isOpen={showVoiceSettings}
        onClose={() => setShowVoiceSettings(false)}
        selectedMicId={selectedMicId}
        selectedSpeakerId={selectedSpeakerId}
        onUpdateDevices={updateDevices}
      />
    </div>`
);

// 6. Add Settings button in floating voice dock
code = code.replace(
  /<div className="flex items-center gap-1">/,
  `<div className="flex items-center gap-1">
          <button
            onClick={() => setShowVoiceSettings(true)}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-elevated text-on-surface-variant transition-colors"
            title="Voice Settings"
          >
            <Settings size={18} />
          </button>`
);

fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', code);
console.log('Refactored WorkspaceView.jsx successfully.');
