/**
 * @fileoverview Speech Visualizer Component (SpeechVisualizer.jsx).
 *
 * Renders an animated visual speaking ring indicator using Web Audio API volume
 * analysis when an audio stream is active, or fallback CSS pulse animations.
 *
 * @module components/SpeechVisualizer
 */

import React, { useEffect, useRef } from 'react';

/**
 * SpeechVisualizer Component.
 *
 * Attaches a Web Audio API AnalyserNode to the incoming media stream to extract
 * real-time frequency/volume amplitudes and render an animated canvas glow ring.
 *
 * @param {Object} props - Component properties.
 * @param {MediaStream} [props.stream] - Active audio MediaStream from local mic or remote peer.
 * @param {boolean} [props.isSpeaking] - Fallback boolean indicator when stream analyser is inactive.
 * @param {number} [props.size=32] - Diameter of the inner avatar in pixels.
 * @param {string} [props.avatarText] - User avatar initials text.
 * @param {string} [props.color] - Background color of the avatar.
 * @returns {React.ReactElement} Visualizer canvas and avatar container.
 */
export default function SpeechVisualizer({ stream, isSpeaking, size = 32, avatarText, color }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    try {
      // Setup Web Audio API analyser
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const draw = () => {
        analyser.getByteFrequencyData(dataArray);

        // Find average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Draw volume pulse circle
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const baseRadius = (canvas.width / 2) - 8;
        const pulse = average * 0.12;
        const currentRadius = baseRadius + pulse;

        // Outer glow
        if (average > 15) {
          ctx.beginPath();
          ctx.arc(centerX, centerY, currentRadius, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(166, 227, 161, 0.6)';
          ctx.lineWidth = 3;
          ctx.shadowBlur = 12;
          ctx.shadowColor = '#a6e3a1';
          ctx.stroke();
        }

        animationRef.current = requestAnimationFrame(draw);
      };

      draw();
    } catch (e) {
      console.warn('SpeechVisualizer audio initialization failed:', e.message);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [stream]);

  return (
    <div
      style={{
        position: 'relative',
        width: `${size + 16}px`,
        height: `${size + 16}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {stream ? (
        <canvas
          ref={canvasRef}
          width={size + 16}
          height={size + 16}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        />
      ) : (
        isSpeaking && (
          <div
            style={{
              position: 'absolute',
              inset: 2,
              borderRadius: '50%',
              animation: 'voice-pulse 1.4s infinite ease-in-out',
            }}
          />
        )
      )}

      {/* Actual Avatar */}
      <div
        className="avatar"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: color || '#89b4fa',
          color: '#11111b',
          fontSize: `${size * 0.4}px`,
          zIndex: 2,
        }}
      >
        {avatarText}
      </div>
    </div>
  );
}
