import { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { getToken, getVoiceCredentials } from '../services/api';

export function useVoiceRoom({ roomUuid, showToast }) {
  const [inVoice, setInVoice] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [voiceParticipants, setVoiceParticipants] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [mutedByLeaderMsg, setMutedByLeaderMsg] = useState('');
  const [editorOnlyMode, setEditorOnlyMode] = useState(false);
  const [activeSpeakerSocketId, setActiveSpeakerSocketId] = useState(null);

  // Device IDs
  const [selectedMicId, setSelectedMicId] = useState(null);
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(null);

  const voiceSocketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioElementsRef = useRef(new Map());
  const reconnectAttemptsRef = useRef(new Map());
  const credentialsRef = useRef(null);

  const createPeerConnection = useCallback((peerSocketId, stream, iceServers) => {
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

      // Apply the selected speaker device if supported
      if (selectedSpeakerId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(selectedSpeakerId).catch(console.error);
      }
    };

    // NFR-10: WebRTC Connection Retry Logic (Max 3 attempts)
    pc.onconnectionstatechange = async () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        const attempts = reconnectAttemptsRef.current.get(peerSocketId) || 0;
        if (attempts < 3) {
          reconnectAttemptsRef.current.set(peerSocketId, attempts + 1);
          const attemptMsg = `Connection unstable. Attempting to reconnect (${attempts + 1}/3)...`;
          console.warn(`[Voice] Peer ${peerSocketId} failed. Attempting reconnect ${attempts + 1}/3...`);
          showToast(attemptMsg, 'warning');
          
          try {
            // Trigger ICE Restart
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            if (voiceSocketRef.current) {
              voiceSocketRef.current.emit('voice:offer', { to: peerSocketId, sdp: offer });
            }
          } catch (e) {
            console.error('[Voice] Reconnect ICE restart failed', e);
          }
        } else {
          showToast(`Voice connection failed after 3 attempts. Please rejoin the call.`, 'error');
          leaveVoice();
        }
      } else if (pc.connectionState === 'connected') {
        // Reset attempts on successful connection
        reconnectAttemptsRef.current.set(peerSocketId, 0);
      }
    };

    return pc;
  }, [selectedSpeakerId, showToast]);

  const closePeerConnection = useCallback((peerSocketId) => {
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
    reconnectAttemptsRef.current.delete(peerSocketId);
  }, []);

  const leaveVoice = useCallback(() => {
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
    reconnectAttemptsRef.current.clear();
    setInVoice(false);
    setVoiceParticipants([]);
    setActiveSpeakerSocketId(null);
  }, [localStream]);

  const joinVoice = useCallback(async () => {
    if (inVoice) return;
    setMutedByLeaderMsg('');

    try {
      const constraints = { 
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true, 
        video: false 
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);

      const credsData = await getVoiceCredentials(roomUuid);
      credentialsRef.current = credsData;

      const freshToken = getToken();

      const isViteDev = window.location.port === '5173';
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const backendUrl = isViteDev 
        ? 'http://localhost:3000' 
        : (isLocal ? window.location.origin : 'https://collabide-backend-avau.onrender.com');

      const socket = io(backendUrl + '/voice', {
        auth: { token: freshToken },
        transports: ['websocket'],
        forceNew: true,
        timeout: 10000,
        reconnection: false,
      });
      voiceSocketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('voice:join', { roomUuid });
        setInVoice(true);
      });

      socket.on('connect_error', (err) => {
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
        let pc = peerConnectionsRef.current.get(from);
        if (!pc) {
          pc = createPeerConnection(from, stream, credsData.iceServers);
        }
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
        const myEntry = participants.find(p => p.socketId === socket.id);
        if (myEntry && myEntry.isMuted) {
          setIsMuted(true);
          stream.getAudioTracks().forEach((track) => (track.enabled = false));
        }
      });

      socket.on('voice:room-settings', ({ editorOnlyMode }) => {
        setEditorOnlyMode(editorOnlyMode);
      });

      socket.on('voice:speaker-active', ({ socketId }) => {
        setActiveSpeakerSocketId(socketId);
      });

      socket.on('voice:error', ({ message }) => {
        showToast(message, 'error');
      });

    } catch (err) {
      showToast(`Could not access microphone: ${err.message}`, 'error');
    }
  }, [inVoice, roomUuid, selectedMicId, createPeerConnection, closePeerConnection, leaveVoice, showToast]);

  const toggleMuteSelf = useCallback(() => {
    if (!localStream || !voiceSocketRef.current) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMute;
    });

    voiceSocketRef.current.emit('voice:mute-self', { isMuted: nextMute });
  }, [localStream, isMuted]);

  const toggleEditorOnlyVoice = useCallback(() => {
    if (!voiceSocketRef.current) return;
    voiceSocketRef.current.emit('voice:set-editor-only', { enabled: !editorOnlyMode });
  }, [editorOnlyMode]);

  const handleMuteAll = useCallback(() => {
    if (!voiceSocketRef.current) return;
    voiceSocketRef.current.emit('voice:mute-all');
  }, []);

  const handleHardMuteParticipant = useCallback((targetSocketId, currentlyHard) => {
    if (!voiceSocketRef.current) return;
    if (currentlyHard) {
      voiceSocketRef.current.emit('voice:unmute-participant', { targetSocketId });
    } else {
      voiceSocketRef.current.emit('voice:mute-participant', { targetSocketId, hard: true });
    }
  }, []);

  // Update Devices on the fly
  const updateDevices = useCallback(async (newMicId, newSpeakerId) => {
    if (newSpeakerId !== selectedSpeakerId) {
      setSelectedSpeakerId(newSpeakerId);
      // Update all existing audio elements
      audioElementsRef.current.forEach((audio) => {
        if (typeof audio.setSinkId === 'function') {
          audio.setSinkId(newSpeakerId).catch(console.error);
        }
      });
    }

    if (newMicId !== selectedMicId) {
      setSelectedMicId(newMicId);
      if (inVoice && localStream) {
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: newMicId } },
            video: false
          });
          
          // Stop old tracks
          localStream.getTracks().forEach(t => t.stop());
          setLocalStream(newStream);

          // Apply mute state to new track
          newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);

          // Replace track in all peer connections
          const newAudioTrack = newStream.getAudioTracks()[0];
          peerConnectionsRef.current.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (sender) {
              sender.replaceTrack(newAudioTrack).catch(console.error);
            }
          });
        } catch (err) {
          showToast(`Failed to switch microphone: ${err.message}`, 'error');
        }
      }
    }
  }, [selectedMicId, selectedSpeakerId, inVoice, localStream, isMuted, showToast]);

  return {
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
  };
}
