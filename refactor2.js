const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

// 1. Replace imports
code = code.replace(
  "import VoiceSettingsModal from './VoiceSettingsModal';",
  "import VoiceDeviceMenu from './VoiceDeviceMenu';"
);

// We need to replace the floating dock.
const dockRegex = /\{\/\* Floating Voice Dock \*\/\}[\s\S]*?(?=\{\/\* Admin lock overlay notifications \*\/)/;

const newDock = `      {/* Floating Voice Dock (Google Meet Style) */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center bg-[#202124] h-[52px] rounded-full border border-outline/20 shadow-2xl z-50 px-3">
        
        {inVoice ? (
          <>
            <div className="relative flex items-center">
              <button
                onClick={toggleMuteSelf}
                className={\`w-10 h-10 flex items-center justify-center rounded-full transition-colors border \${
                  isMuted 
                    ? 'bg-[#ea4335] text-white border-transparent hover:bg-[#d93025]' 
                    : 'bg-[#3c4043] text-white border-transparent hover:bg-[#434649]'
                }\`}
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

            <div className="w-px h-6 bg-[#3c4043] mx-2" />

            {isUserLeader && (
              <div className="flex items-center gap-1 mr-1">
                <button 
                  onClick={handleMuteAll} 
                  className="px-3 h-9 text-xs font-medium text-[#ea4335] hover:bg-[#ea4335]/10 rounded-md transition-colors"
                >
                  Mute all
                </button>
                <button 
                  onClick={toggleEditorOnlyVoice} 
                  className="px-3 h-9 text-xs font-medium text-[#8ab4f8] hover:bg-[#8ab4f8]/10 rounded-md transition-colors"
                >
                  {editorOnlyMode ? 'Unlock voice' : 'Lock voice'}
                </button>
              </div>
            )}

            <button
              onClick={leaveVoice}
              className="px-5 h-10 flex items-center justify-center rounded-full bg-[#ea4335] text-white text-sm font-medium hover:bg-[#d93025] transition-colors gap-2 ml-1"
            >
              <span className="material-symbols-outlined text-[18px]">call_end</span>
              Leave
            </button>
          </>
        ) : (
          <div className="relative flex items-center h-10">
            <button
              onClick={joinVoice}
              className="px-5 h-10 flex items-center justify-center rounded-full bg-[#8ab4f8] text-[#202124] text-sm font-medium hover:bg-[#92bcfc] transition-colors gap-2"
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

`;

code = code.replace(dockRegex, newDock);

// Also remove VoiceSettingsModal from the bottom of the file if it exists there
code = code.replace(
  /<VoiceSettingsModal[\s\S]*?\/>\s*<\/div>/,
  '</div>'
);

fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', code);
console.log('Refactored WorkspaceView UI');
