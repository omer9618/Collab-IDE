import React, { useEffect, useState } from 'react';

export default function VoiceSettingsModal({ isOpen, onClose, selectedMicId, selectedSpeakerId, onUpdateDevices }) {
  const [devices, setDevices] = useState([]);
  const [micId, setMicId] = useState(selectedMicId || '');
  const [speakerId, setSpeakerId] = useState(selectedSpeakerId || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    
    let isMounted = true;
    const fetchDevices = async () => {
      try {
        // Must request permission first so labels are not empty in some browsers
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        if (isMounted) {
          setDevices(allDevices);
          
          if (!micId) {
            const defaultMic = allDevices.find(d => d.kind === 'audioinput' && d.deviceId === 'default') || allDevices.find(d => d.kind === 'audioinput');
            if (defaultMic) setMicId(defaultMic.deviceId);
          }
          if (!speakerId) {
            const defaultSpeaker = allDevices.find(d => d.kind === 'audiooutput' && d.deviceId === 'default') || allDevices.find(d => d.kind === 'audiooutput');
            if (defaultSpeaker) setSpeakerId(defaultSpeaker.deviceId);
          }
        }
      } catch (err) {
        if (isMounted) setError('Could not access media devices. Please allow microphone permissions.');
      }
    };
    
    fetchDevices();
    
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

  const handleSave = () => {
    onUpdateDevices(micId, speakerId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-surface border border-outline shadow-2xl rounded-lg w-[400px] flex flex-col animate-in zoom-in-95">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline-subtle flex justify-between items-center">
          <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-accent-blue">settings_voice</span>
            Voice Settings
          </h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-6">
          {error ? (
            <div className="p-3 bg-red-950/40 border border-accent-red rounded text-accent-red text-sm">
              {error}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">mic</span> Microphone
                </label>
                <select
                  value={micId}
                  onChange={(e) => setMicId(e.target.value)}
                  className="bg-surface-variant text-on-surface text-sm border border-outline-subtle rounded px-3 py-2 outline-none focus:border-accent-blue transition-colors"
                >
                  {audioInputs.length === 0 && <option value="">No microphones found</option>}
                  {audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 5)}...)`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">volume_up</span> Speakers
                </label>
                {audioOutputs.length > 0 ? (
                  <select
                    value={speakerId}
                    onChange={(e) => setSpeakerId(e.target.value)}
                    className="bg-surface-variant text-on-surface text-sm border border-outline-subtle rounded px-3 py-2 outline-none focus:border-accent-blue transition-colors"
                  >
                    {audioOutputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Speaker (${d.deviceId.slice(0, 5)}...)`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-xs text-on-surface-variant px-1">
                    Speaker selection is not supported in this browser, or no devices found.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-outline-subtle flex justify-end gap-3 bg-surface-variant/30 rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-medium text-on-surface-variant hover:bg-surface-variant transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!!error}
            className="px-4 py-2 rounded text-sm font-medium bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            Save Settings
          </button>
        </div>

      </div>
    </div>
  );
}
