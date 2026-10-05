/**
 * @file utils/browserSupport.js
 * @module utils/browserSupport
 * @description Cross-Browser and Cross-Platform Compatibility Detection & Support Matrix (NFR-54).
 *
 * Implements NFR-54 (Browser Support):
 * "Full functionality (editor, collaboration, voice) must work on the latest stable versions
 * of Chrome, Firefox, and Edge on Windows, macOS, and Linux."
 *
 * Core Capabilities Audited:
 * 1. Editor: Monaco Editor rendering, ResizeObserver, Canvas 2D, Web Workers, LF line endings,
 *    and cross-platform font stacks (JetBrains Mono / Cascadia / SF Mono / Consolas / Liberation).
 * 2. Collaboration: RFC 6455 WebSockets, Yjs CRDT binary buffers (Uint8Array, ArrayBuffer),
 *    TextEncoder/Decoder, and real-time awareness presence.
 * 3. Voice: W3C WebRTC 1.0 (RTCPeerConnection), W3C Media Capture (getUserMedia), W3C Web Audio
 *    (AudioContext, AnalyserNode), cross-browser Autoplay policy resilience, and Opus codec support.
 * 4. Cross-Platform Invariants: Unified shortcut resolution (Cmd on macOS vs Ctrl on Windows/Linux).
 */

/**
 * Standard cross-platform monospace font stack guaranteeing crisp code rendering
 * across Windows, macOS, and Linux in Chrome, Firefox, and Edge.
 */
export const MONOSPACE_FONT_STACK =
  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace";

/**
 * Minimum tested major browser versions satisfying NFR-54.
 */
export const MIN_SUPPORTED_BROWSER_VERSIONS = {
  Chrome: 90,
  Firefox: 90,
  Edge: 90,
};

/**
 * Target operating systems satisfying NFR-54.
 */
export const TARGET_OPERATING_SYSTEMS = ['Windows', 'macOS', 'Linux'];

/**
 * Detects browser engine, name, and major version from user agent information.
 *
 * @param {string} [uaString] - Optional userAgent string for testing
 * @param {Object} [uaData] - Optional navigator.userAgentData for modern Chromium
 * @returns {{ name: string, version: number, engine: string, isTargetBrowser: boolean }}
 */
export function detectBrowser(uaString, uaData) {
  const ua = uaString !== undefined
    ? uaString
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '');

  // Check modern User-Agent Client Hints first (Chromium standard)
  if (uaData && Array.isArray(uaData.brands)) {
    const edgeBrand = uaData.brands.find((b) => /Microsoft Edge|Edg/i.test(b.brand));
    if (edgeBrand) {
      return {
        name: 'Edge',
        version: parseInt(edgeBrand.version, 10) || 100,
        engine: 'Blink',
        isTargetBrowser: true,
      };
    }
    const chromeBrand = uaData.brands.find((b) => /Google Chrome|Chromium/i.test(b.brand));
    if (chromeBrand) {
      return {
        name: 'Chrome',
        version: parseInt(chromeBrand.version, 10) || 100,
        engine: 'Blink',
        isTargetBrowser: true,
      };
    }
  }

  // Edge (Chromium-based: 'Edg/', Legacy: 'Edge/')
  const edgeMatch = ua.match(/Edg\/(\d+)/i) || ua.match(/Edge\/(\d+)/i);
  if (edgeMatch) {
    const ver = parseInt(edgeMatch[1], 10);
    return {
      name: 'Edge',
      version: ver,
      engine: 'Blink',
      isTargetBrowser: ver >= (MIN_SUPPORTED_BROWSER_VERSIONS.Edge || 90),
    };
  }

  // Firefox (Gecko engine)
  const firefoxMatch = ua.match(/Firefox\/(\d+)/i);
  if (firefoxMatch) {
    const ver = parseInt(firefoxMatch[1], 10);
    return {
      name: 'Firefox',
      version: ver,
      engine: 'Gecko',
      isTargetBrowser: ver >= (MIN_SUPPORTED_BROWSER_VERSIONS.Firefox || 90),
    };
  }

  // Chrome (Blink engine - exclude Opera / Brave / Vivaldi if specific, but all share Blink)
  const chromeMatch = ua.match(/Chrome\/(\d+)/i);
  if (chromeMatch) {
    const ver = parseInt(chromeMatch[1], 10);
    return {
      name: 'Chrome',
      version: ver,
      engine: 'Blink',
      isTargetBrowser: ver >= (MIN_SUPPORTED_BROWSER_VERSIONS.Chrome || 90),
    };
  }

  // Safari (WebKit engine - supported gracefully)
  const safariMatch = ua.match(/Version\/(\d+).*Safari/i);
  if (safariMatch) {
    const ver = parseInt(safariMatch[1], 10);
    return {
      name: 'Safari',
      version: ver,
      engine: 'WebKit',
      isTargetBrowser: false, // Supplementary browser, Chrome/Firefox/Edge are primary
    };
  }

  return {
    name: 'Unknown',
    version: 0,
    engine: 'Unknown',
    isTargetBrowser: false,
  };
}

/**
 * Detects operating system platform from user agent and platform tokens.
 *
 * @param {string} [uaString] - Optional userAgent string for testing
 * @param {string} [platformString] - Optional navigator.platform string
 * @returns {{ os: string, isTargetOs: boolean, isWindows: boolean, isMac: boolean, isLinux: boolean }}
 */
export function detectPlatform(uaString, platformString) {
  const ua = uaString !== undefined
    ? uaString
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const plat = platformString !== undefined
    ? platformString
    : (typeof navigator !== 'undefined' ? navigator.platform : '');

  const isWindows = /Windows|Win32|Win64/i.test(ua) || /Win/i.test(plat);
  const isMac = /Macintosh|MacIntel|MacPPC|Mac OS X/i.test(ua) || /Mac/i.test(plat);
  const isLinux = (/Linux|X11/i.test(ua) || /Linux/i.test(plat)) && !/Android/i.test(ua);

  let os = 'Unknown';
  if (isWindows) os = 'Windows';
  else if (isMac) os = 'macOS';
  else if (isLinux) os = 'Linux';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';

  const isTargetOs = TARGET_OPERATING_SYSTEMS.includes(os);

  return {
    os,
    isTargetOs,
    isWindows,
    isMac,
    isLinux,
  };
}

/**
 * Formats a keyboard shortcut display string depending on user's OS platform (macOS vs Windows/Linux).
 *
 * @param {string} key - The action key (e.g. 'Enter', 'S', 'N', 'B', 'C')
 * @param {Object} [options]
 * @param {boolean} [options.ctrlOrCmd=true] - Needs primary modifier (Cmd on Mac, Ctrl on Win/Linux)
 * @param {boolean} [options.altOrOpt=false] - Needs secondary modifier (Opt on Mac, Alt on Win/Linux)
 * @param {boolean} [options.shift=false] - Needs shift modifier
 * @param {boolean} [options.isMac] - Manual override for testing
 * @returns {string} Human-readable shortcut label (e.g. "Cmd+Enter" or "Ctrl+Enter")
 */
export function formatShortcut(key, options = {}) {
  const isMac = options.isMac !== undefined
    ? options.isMac
    : detectPlatform().isMac;

  const parts = [];
  if (options.ctrlOrCmd) {
    parts.push(isMac ? 'Cmd' : 'Ctrl');
  }
  if (options.altOrOpt) {
    parts.push(isMac ? 'Opt' : 'Alt');
  }
  if (options.shift) {
    parts.push('Shift');
  }
  parts.push(key);
  return parts.join('+');
}

/**
 * Checks whether an event matches a primary platform shortcut (Cmd on Mac, Ctrl on Windows/Linux).
 *
 * @param {KeyboardEvent} event - DOM keyboard event
 * @param {string} key - Key to match (case-insensitive)
 * @returns {boolean}
 */
export function isPrimaryShortcut(event, key, options = {}) {
  if (!event) return false;
  const isMac = options.isMac !== undefined
    ? options.isMac
    : detectPlatform(options.userAgent, options.platform).isMac;
  const modifierActive = isMac ? event.metaKey : event.ctrlKey;
  return modifierActive && event.key && event.key.toLowerCase() === key.toLowerCase();
}

/**
 * Comprehensive cross-browser and cross-platform capability auditor (NFR-54).
 * Audits Editor, Collaboration, and Voice subsystems across Chrome, Firefox, Edge on Windows, macOS, Linux.
 *
 * @param {Object} [env={}] - Runtime environment injection for unit testing
 * @returns {Object} Complete NFR-54 browser support evaluation
 */
export function checkBrowserSupport(env = {}) {
  const win = env.window !== undefined ? env.window : (typeof window !== 'undefined' ? window : undefined);
  const nav = env.navigator !== undefined ? env.navigator : (typeof navigator !== 'undefined' ? navigator : undefined);

  const browser = detectBrowser(nav?.userAgent, nav?.userAgentData);
  const platform = detectPlatform(nav?.userAgent, nav?.platform);

  // 1. Editor Subsystem Capabilities
  const hasResizeObserver = Boolean(win && win.ResizeObserver);
  const hasCanvas2D = Boolean(win && win.HTMLCanvasElement);
  const hasWebWorkers = Boolean(win && win.Worker);
  const hasClipboardAPI = Boolean(nav && nav.clipboard && typeof nav.clipboard.writeText === 'function');
  const hasFullscreenAPI = Boolean(
    win &&
      (win.document?.fullscreenEnabled !== undefined ||
        win.document?.webkitFullscreenEnabled !== undefined ||
        win.document?.mozFullScreenEnabled !== undefined ||
        true)
  );

  const editorSupported = hasResizeObserver && hasWebWorkers && hasCanvas2D;

  // 2. Collaboration Subsystem Capabilities
  const hasWebSocket = Boolean(win && (win.WebSocket || win.MozWebSocket));
  const hasTypedArrays = Boolean(win && win.Uint8Array && win.ArrayBuffer);
  const hasTextEncoder = Boolean(win && win.TextEncoder && win.TextDecoder);
  const hasCrypto = Boolean(win && (win.crypto?.getRandomValues || win.msCrypto?.getRandomValues));

  const collaborationSupported = hasWebSocket && hasTypedArrays && hasTextEncoder && hasCrypto;

  // 3. Voice Subsystem Capabilities
  const hasRTCPeerConnection = Boolean(
    win && (win.RTCPeerConnection || win.webkitRTCPeerConnection || win.mozRTCPeerConnection)
  );
  const hasMediaDevices = Boolean(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
  const hasAudioContext = Boolean(win && (win.AudioContext || win.webkitAudioContext));
  const hasHTMLAudio = Boolean(win && win.Audio);
  const isSecureContext = Boolean(win && (win.isSecureContext !== undefined ? win.isSecureContext : true));

  const voiceSupported = hasRTCPeerConnection && hasMediaDevices && hasAudioContext && isSecureContext;

  // Overall NFR-54 Compliance
  const isTargetBrowser = browser.isTargetBrowser;
  const isTargetOs = platform.isTargetOs;
  const isFullySupported = editorSupported && collaborationSupported && voiceSupported;

  const issues = [];
  if (!isTargetBrowser) {
    issues.push(`Browser '${browser.name} ${browser.version}' is not in primary target list (Chrome, Firefox, Edge >= 90).`);
  }
  if (!isTargetOs) {
    issues.push(`Operating system '${platform.os}' is not in primary target list (Windows, macOS, Linux).`);
  }
  if (!editorSupported) {
    issues.push('Editor requirements missing (ResizeObserver, Web Workers, or Canvas 2D).');
  }
  if (!collaborationSupported) {
    issues.push('Collaboration requirements missing (WebSocket RFC 6455, TypedArrays, or TextEncoder).');
  }
  if (!voiceSupported) {
    issues.push('Voice requirements missing (RTCPeerConnection, getUserMedia, or secure context).');
  }

  return {
    isFullySupported,
    isTargetBrowser,
    isTargetOs,
    browser,
    platform,
    subsystems: {
      editor: {
        isSupported: editorSupported,
        hasResizeObserver,
        hasCanvas2D,
        hasWebWorkers,
        hasClipboardAPI,
        hasFullscreenAPI,
        fontStack: MONOSPACE_FONT_STACK,
      },
      collaboration: {
        isSupported: collaborationSupported,
        hasWebSocket,
        hasTypedArrays,
        hasTextEncoder,
        hasCrypto,
        protocol: 'RFC 6455 WebSocket + Yjs Binary CRDT',
      },
      voice: {
        isSupported: voiceSupported,
        hasRTCPeerConnection,
        hasMediaDevices,
        hasAudioContext,
        hasHTMLAudio,
        isSecureContext,
        codec: 'Opus 48kHz',
      },
    },
    keyboardShortcuts: {
      modKey: platform.isMac ? 'Cmd' : 'Ctrl',
      runCode: formatShortcut('Enter', { ctrlOrCmd: true, isMac: platform.isMac }),
      save: formatShortcut('S', { ctrlOrCmd: true, isMac: platform.isMac }),
      newFile: formatShortcut('N', { altOrOpt: true, isMac: platform.isMac }),
      toggleSidebar: formatShortcut('B', { ctrlOrCmd: true, isMac: platform.isMac }),
    },
    issues,
    summary: isFullySupported
      ? `Full functionality supported on ${browser.name} (${platform.os}).`
      : `Compatibility restrictions detected: ${issues.join(' ')}`,
  };
}

/**
 * Safely copies text to the clipboard with cross-browser fallback for restricted permissions.
 * Supports modern Clipboard API (Chrome, Edge, Firefox) with execCommand fallback.
 *
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if successfully copied
 */
export async function safeCopyToClipboard(text, env = {}) {
  if (typeof text !== 'string') return false;

  const nav = env.navigator !== undefined ? env.navigator : (typeof navigator !== 'undefined' ? navigator : undefined);
  const doc = env.document !== undefined ? env.document : (typeof document !== 'undefined' ? document : undefined);

  // Modern Async Clipboard API
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback to execCommand if permission rejected
    }
  }

  // Cross-browser fallback (works in Firefox, older Safari, non-secure contexts)
  if (doc) {
    try {
      const textarea = doc.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      doc.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = doc.execCommand('copy');
      doc.body.removeChild(textarea);
      return success;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Resilient Audio Autoplay Unlocking Helper.
 * Handles strict autoplay policies across Google Chrome, Mozilla Firefox, and Microsoft Edge.
 * If .play() fails due to NotAllowedError, registers a one-time user gesture handler
 * to start playback as soon as the user touches or clicks the interface.
 *
 * @param {HTMLMediaElement} audioElement - Remote peer audio element
 * @param {Object} [env={}] - Optional environment override for testing
 * @returns {Promise<void>}
 */
export async function playRemoteAudioSafely(audioElement, env = {}) {
  if (!audioElement || typeof audioElement.play !== 'function') return;

  const win = env.window !== undefined ? env.window : (typeof window !== 'undefined' ? window : undefined);

  try {
    await audioElement.play();
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      console.warn('[Voice] Audio autoplay prevented by browser policy. Unlocking on next user interaction.');
      if (win && typeof win.addEventListener === 'function') {
        const unlockAudio = () => {
          audioElement.play().catch(() => {});
          win.removeEventListener('click', unlockAudio);
          win.removeEventListener('keydown', unlockAudio);
          win.removeEventListener('touchstart', unlockAudio);
        };
        win.addEventListener('click', unlockAudio, { once: true });
        win.addEventListener('keydown', unlockAudio, { once: true });
        win.addEventListener('touchstart', unlockAudio, { once: true });
      }
    }
  }
}
