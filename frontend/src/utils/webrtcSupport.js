/**
 * @file utils/webrtcSupport.js
 * @module utils/webrtcSupport
 * @description Native WebRTC and Zero-Client-Installation capability detection (NFR-44).
 *
 * Implements NFR-44 (Zero Client Installation):
 * "The complete application including voice chat must run in a modern browser with no plugins
 * or extensions. WebRTC audio must work natively."
 *
 * Key Invariants:
 * 1. Zero External Plugins: No Adobe Flash, Silverlight, Java applets, or NPAPI/ActiveX controls.
 * 2. Zero Browser Extensions: No Chrome extensions, Firefox add-ons, or custom browser agents required.
 * 3. 100% Native Web Standards: Relies strictly on standard W3C WebRTC 1.0, W3C Media Capture and
 *    Streams, W3C Web Audio API, and RFC 6455 WebSockets.
 * 4. Cross-Browser Interoperability: Verified natively on modern Google Chrome, Mozilla Firefox,
 *    Apple Safari, and Microsoft Edge across Windows, macOS, and Linux (NFR-54).
 */

/**
 * Validates whether the current browser runtime natively supports WebRTC audio
 * without requiring any third-party plugins or browser extensions.
 *
 * @function checkNativeWebRTCSupport
 * @param {Object} [env={}] - Optional runtime environment injection for testing
 * @param {Window} [env.window] - Window object override
 * @param {Navigator} [env.navigator] - Navigator object override
 * @returns {{
 *   isSupported: boolean,
 *   hasRTCPeerConnection: boolean,
 *   hasMediaDevices: boolean,
 *   hasAudioContext: boolean,
 *   isSecureContext: boolean,
 *   requiresPlugin: false,
 *   requiresExtension: false,
 *   reason: string|null,
 *   errorGuidance: string|null
 * }} Detailed capability status and plain-English user guidance
 */
export function checkNativeWebRTCSupport(env = {}) {
  const globalWindow = env.window !== undefined ? env.window : (typeof window !== 'undefined' ? window : undefined);
  const globalNavigator = env.navigator !== undefined ? env.navigator : (typeof navigator !== 'undefined' ? navigator : undefined);

  // W3C WebRTC 1.0: RTCPeerConnection standard interface
  const hasRTCPeerConnection = Boolean(
    globalWindow &&
      (globalWindow.RTCPeerConnection ||
        globalWindow.webkitRTCPeerConnection ||
        globalWindow.mozRTCPeerConnection)
  );

  // W3C Media Capture and Streams: navigator.mediaDevices.getUserMedia
  const hasMediaDevices = Boolean(
    globalNavigator &&
      globalNavigator.mediaDevices &&
      typeof globalNavigator.mediaDevices.getUserMedia === 'function'
  );

  // W3C Web Audio API: AudioContext for native speech volume analysis
  const hasAudioContext = Boolean(
    globalWindow && (globalWindow.AudioContext || globalWindow.webkitAudioContext)
  );

  // Secure context invariant (HTTPS or localhost required for microphone access)
  const isSecureContext = Boolean(
    globalWindow &&
      (globalWindow.isSecureContext !== undefined ? globalWindow.isSecureContext : true)
  );

  const isSupported = hasRTCPeerConnection && hasMediaDevices;

  let reason = null;
  let errorGuidance = null;

  if (!isSupported) {
    if (!hasRTCPeerConnection && !hasMediaDevices) {
      reason = 'MISSING_WEBRTC_AND_MEDIA_DEVICES';
      errorGuidance =
        'Your browser does not support native WebRTC audio. Please open CollabIDE in a modern browser (Google Chrome, Mozilla Firefox, Microsoft Edge, or Apple Safari). No plugins or extensions are needed.';
    } else if (!hasRTCPeerConnection) {
      reason = 'MISSING_RTC_PEER_CONNECTION';
      errorGuidance =
        'Native RTCPeerConnection is unavailable in this browser. Please upgrade to a modern browser to use native voice chat without plugins.';
    } else if (!hasMediaDevices) {
      if (!isSecureContext) {
        reason = 'INSECURE_CONTEXT';
        errorGuidance =
          'Microphone access requires a secure HTTPS connection or localhost. Please access CollabIDE over HTTPS to use native voice chat.';
      } else {
        reason = 'MISSING_MEDIA_DEVICES';
        errorGuidance =
          'Microphone device access is not supported by your current browser. Please use a modern browser with native media support.';
      }
    }
  }

  return {
    isSupported,
    hasRTCPeerConnection,
    hasMediaDevices,
    hasAudioContext,
    isSecureContext,
    // NFR-44 Core Invariants: Always false
    requiresPlugin: false,
    requiresExtension: false,
    reason,
    errorGuidance,
  };
}

/**
 * Returns plain-English user feedback for common browser media permission errors (NFR-47).
 *
 * @function getMediaErrorGuidance
 * @param {Error|DOMException} err - Browser getUserMedia exception
 * @returns {string} Plain-English explanation
 */
export function getMediaErrorGuidance(err) {
  if (!err) {
    return 'Could not access microphone due to an unknown issue. No plugins are required.';
  }

  const name = err.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone permission was denied. Please allow microphone access in your browser address bar to join voice chat. No plugins or extensions are needed.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was detected on your system. Please connect an audio input device to join voice chat.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your microphone is currently in use by another application. Please close other voice apps and try again.';
  }
  if (name === 'OverconstrainedError') {
    return 'The requested audio settings are not supported by your hardware microphone. Default audio settings will be applied.';
  }
  if (name === 'SecurityError') {
    return 'Microphone access is restricted in this context. Please ensure you are connected securely via HTTPS.';
  }

  return `Could not access microphone: ${err.message || 'Unknown device error'}. CollabIDE runs natively without plugins.`;
}
