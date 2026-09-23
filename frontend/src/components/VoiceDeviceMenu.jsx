import React, { useEffect, useState } from 'react';
import { Mic, Volume2, Check } from 'lucide-react';

export default function VoiceDeviceMenu({ isOpen, onClose, selectedMicId, selectedSpeakerId, onUpdateDevices }) {
  const [devices, setDevices] = useState([]);
  const [micId, setMicId] = useState(selectedMicId || '');
  const [speakerId, setSpeakerId] = useState(selectedSpeakerId || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    
    let isMounted = true;
    const fetchDevices = async () => {
      try {
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
        if (isMounted) setError('Could not access media devices.');
      }
    };
    
    fetchDevices();
    
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Update immediately when a user clicks a device
  const handleSelectMic = (id) => {
    setMicId(id);
    onUpdateDevices(id, speakerId);
  };

  const handleSelectSpeaker = (id) => {
    setSpeakerId(id);
    onUpdateDevices(micId, id);
  };

  if (!isOpen) return null;

  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div className="absolute bottom-[60px] left-0 w-[280px] bg-surface-elevated border border-outline/50 shadow-2xl rounded-xl p-2 z-[70] animate-in slide-in-from-bottom-2 fade-in">
        
        {error ? (
          <div className="p-3 text-accent-red text-xs">{error}</div>
        ) : (
          <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto custom-scrollbar">
            
            {/* Microphones */}
            <div className="text-[10px] font-bold text-on-surface-muted uppercase px-3 pt-2 pb-1 tracking-wider">
              Microphone
            </div>
            {audioInputs.length === 0 && <div className="text-xs text-on-surface-variant px-3 py-1">No mics found</div>}
            {audioInputs.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => handleSelectMic(d.deviceId)}
                className="flex items-center gap-3 w-full px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-variant rounded-lg transition-colors group"
              >
                <Mic size={14} className={micId === d.deviceId ? 'text-accent-blue' : 'text-on-surface-muted'} />
                <span className="truncate flex-1">{d.label || 'Microphone'}</span>
                {micId === d.deviceId && <Check size={14} className="text-accent-blue" />}
              </button>
            ))}

            <div className="w-full h-px bg-outline/30 my-1" />

            {/* Speakers */}
            <div className="text-[10px] font-bold text-on-surface-muted uppercase px-3 pt-2 pb-1 tracking-wider">
              Speakers
            </div>
            {audioOutputs.length === 0 && <div className="text-xs text-on-surface-variant px-3 py-1">No speakers found</div>}
            {audioOutputs.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => handleSelectSpeaker(d.deviceId)}
                className="flex items-center gap-3 w-full px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-variant rounded-lg transition-colors group"
              >
                <Volume2 size={14} className={speakerId === d.deviceId ? 'text-accent-blue' : 'text-on-surface-muted'} />
                <span className="truncate flex-1">{d.label || 'Speaker'}</span>
                {speakerId === d.deviceId && <Check size={14} className="text-accent-blue" />}
              </button>
            ))}
            
          </div>
        )}
      </div>
    </>
  );
}
