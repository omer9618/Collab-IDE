/**
 * @file test/test_nfr54_browser_support.js
 * @description Automated Verification Suite for NFR-54: Browser Support.
 *
 * Implements NFR-54 requirements:
 * "Full functionality (editor, collaboration, voice) must work on the latest stable
 * versions of Chrome, Firefox, and Edge on Windows, macOS, and Linux."
 *
 * Test Categories:
 * 1. Architecture Registry & Static Codebase Audit (Cross-platform fonts, Monaco keybindings, CSS)
 * 2. Cross-Browser & OS Compatibility Matrix (9 Matrix Combinations: Chrome/Firefox/Edge x Windows/macOS/Linux)
 * 3. Editor Subsystem Invariants (Monaco, ResizeObserver, Canvas 2D, Workers, Clipboard API)
 * 4. Collaboration Subsystem Invariants (RFC 6455 WebSockets, Binary CRDT buffers, Yjs)
 * 5. Voice Subsystem Invariants (WebRTC 1.0, getUserMedia, Autoplay policy unlocking, AudioContext)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as Y from 'yjs';
import {
  MONOSPACE_FONT_STACK,
  MIN_SUPPORTED_BROWSER_VERSIONS,
  TARGET_OPERATING_SYSTEMS,
  detectBrowser,
  detectPlatform,
  formatShortcut,
  isPrimaryShortcut,
  checkBrowserSupport,
  safeCopyToClipboard,
  playRemoteAudioSafely,
} from '../src/utils/browserSupport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n================================================================');
console.log('🧪 Starting NFR-54: Browser Support Automated Test Suite');
console.log('================================================================\n');

// ============================================================================
// Phase 1: Architecture Registry & Static Codebase Audit
// ============================================================================
console.log('🔍 Phase 1: Architecture Registry & Static Codebase Audit...');

// 1. Verify browserSupport exports
assert(typeof detectBrowser === 'function', 'detectBrowser helper exported');
assert(typeof detectPlatform === 'function', 'detectPlatform helper exported');
assert(typeof formatShortcut === 'function', 'formatShortcut helper exported');
assert(typeof isPrimaryShortcut === 'function', 'isPrimaryShortcut helper exported');
assert(typeof checkBrowserSupport === 'function', 'checkBrowserSupport auditor exported');
assert(typeof safeCopyToClipboard === 'function', 'safeCopyToClipboard helper exported');
assert(typeof playRemoteAudioSafely === 'function', 'playRemoteAudioSafely helper exported');

// 2. Minimum browser versions & target OS
assert(MIN_SUPPORTED_BROWSER_VERSIONS.Chrome >= 90, 'Minimum supported Chrome version >= 90');
assert(MIN_SUPPORTED_BROWSER_VERSIONS.Firefox >= 90, 'Minimum supported Firefox version >= 90');
assert(MIN_SUPPORTED_BROWSER_VERSIONS.Edge >= 90, 'Minimum supported Edge version >= 90');
assert(TARGET_OPERATING_SYSTEMS.includes('Windows'), 'Target OS includes Windows');
assert(TARGET_OPERATING_SYSTEMS.includes('macOS'), 'Target OS includes macOS');
assert(TARGET_OPERATING_SYSTEMS.includes('Linux'), 'Target OS includes Linux');

// 3. Monospace font stack cross-platform fallbacks
assert(MONOSPACE_FONT_STACK.includes('JetBrains Mono'), 'Font stack includes JetBrains Mono');
assert(MONOSPACE_FONT_STACK.includes('Cascadia Code'), 'Font stack includes Cascadia Code (Windows)');
assert(MONOSPACE_FONT_STACK.includes('SF Mono'), 'Font stack includes SF Mono (macOS)');
assert(MONOSPACE_FONT_STACK.includes('Menlo'), 'Font stack includes Menlo (macOS fallback)');
assert(MONOSPACE_FONT_STACK.includes('Consolas'), 'Font stack includes Consolas (Windows fallback)');
assert(MONOSPACE_FONT_STACK.includes('Liberation Mono'), 'Font stack includes Liberation Mono (Linux)');
assert(MONOSPACE_FONT_STACK.includes('monospace'), 'Font stack terminates in generic monospace');

// 4. CSS cross-browser styles audit (index.css)
const indexCssPath = path.join(frontendDir, 'src', 'index.css');
const indexCss = fs.readFileSync(indexCssPath, 'utf-8');
assert(indexCss.includes('-webkit-font-smoothing: antialiased;'), 'index.css has -webkit-font-smoothing');
assert(indexCss.includes('-moz-osx-font-smoothing: grayscale;'), 'index.css has -moz-osx-font-smoothing (Firefox macOS)');
assert(indexCss.includes('scrollbar-width: thin;'), 'index.css has standard scrollbar-width (Firefox)');
assert(indexCss.includes('scrollbar-color:'), 'index.css has standard scrollbar-color (Firefox)');
assert(indexCss.includes('::-webkit-scrollbar'), 'index.css has ::-webkit-scrollbar (Chromium)');

// 5. WorkspaceView.jsx static audit
const workspaceViewPath = path.join(frontendDir, 'src', 'components', 'WorkspaceView.jsx');
const workspaceViewCode = fs.readFileSync(workspaceViewPath, 'utf-8');
assert(workspaceViewCode.includes('MONOSPACE_FONT_STACK'), 'WorkspaceView imports MONOSPACE_FONT_STACK');
assert(workspaceViewCode.includes('formatShortcut'), 'WorkspaceView imports formatShortcut');
assert(workspaceViewCode.includes('safeCopyToClipboard'), 'WorkspaceView imports safeCopyToClipboard');
assert(workspaceViewCode.includes('detectPlatform'), 'WorkspaceView imports detectPlatform');
assert(workspaceViewCode.includes('monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter'), 'Monaco registers cross-platform CtrlCmd+Enter keybinding');
assert(workspaceViewCode.includes('monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS'), 'Monaco registers cross-platform CtrlCmd+S keybinding');
assert(workspaceViewCode.includes('model.setEOL(0)'), 'Monaco enforces LF (0) line endings to prevent Windows/POSIX cursor desync');
assert(workspaceViewCode.includes('editorRef.current.layout()'), 'WorkspaceView triggers editor layout recalculation on viewport resize');

// 6. useVoiceRoom.js static audit
const useVoiceRoomPath = path.join(frontendDir, 'src', 'hooks', 'useVoiceRoom.js');
const useVoiceRoomCode = fs.readFileSync(useVoiceRoomPath, 'utf-8');
assert(useVoiceRoomCode.includes('playRemoteAudioSafely'), 'useVoiceRoom imports playRemoteAudioSafely');
assert(useVoiceRoomCode.includes('checkBrowserSupport'), 'useVoiceRoom imports checkBrowserSupport');
assert(useVoiceRoomCode.includes('echoCancellation: true'), 'useVoiceRoom configures standard audio echoCancellation');
assert(useVoiceRoomCode.includes('noiseSuppression: true'), 'useVoiceRoom configures standard audio noiseSuppression');
assert(useVoiceRoomCode.includes('autoGainControl: true'), 'useVoiceRoom configures standard audio autoGainControl');
assert(useVoiceRoomCode.includes('OverconstrainedError'), 'useVoiceRoom provides graceful fallback for OverconstrainedError');

// 7. SpeechVisualizer.jsx static audit
const speechVisualizerPath = path.join(frontendDir, 'src', 'components', 'SpeechVisualizer.jsx');
const speechVisualizerCode = fs.readFileSync(speechVisualizerPath, 'utf-8');
assert(speechVisualizerCode.includes('audioContext.state === \'suspended\''), 'SpeechVisualizer checks for suspended AudioContext');
assert(speechVisualizerCode.includes('audioContext.resume()'), 'SpeechVisualizer resumes AudioContext upon user interaction');

// ============================================================================
// Phase 2: Cross-Browser & OS Compatibility Matrix (9 Combinations)
// ============================================================================
console.log('\n🌐 Phase 2: Cross-Browser & OS Compatibility Matrix (9 Combinations)...');

const browserMatrix = [
  // Chrome on Windows, macOS, Linux
  {
    browser: 'Chrome',
    os: 'Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    platform: 'Win32',
    expectedEngine: 'Blink',
    expectedMod: 'Ctrl',
  },
  {
    browser: 'Chrome',
    os: 'macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    expectedEngine: 'Blink',
    expectedMod: 'Cmd',
  },
  {
    browser: 'Chrome',
    os: 'Linux',
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    platform: 'Linux x86_64',
    expectedEngine: 'Blink',
    expectedMod: 'Ctrl',
  },
  // Firefox on Windows, macOS, Linux
  {
    browser: 'Firefox',
    os: 'Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    platform: 'Win32',
    expectedEngine: 'Gecko',
    expectedMod: 'Ctrl',
  },
  {
    browser: 'Firefox',
    os: 'macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.3; rv:123.0) Gecko/20100101 Firefox/123.0',
    platform: 'MacIntel',
    expectedEngine: 'Gecko',
    expectedMod: 'Cmd',
  },
  {
    browser: 'Firefox',
    os: 'Linux',
    ua: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
    platform: 'Linux x86_64',
    expectedEngine: 'Gecko',
    expectedMod: 'Ctrl',
  },
  // Edge on Windows, macOS, Linux
  {
    browser: 'Edge',
    os: 'Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.2365.92',
    platform: 'Win32',
    expectedEngine: 'Blink',
    expectedMod: 'Ctrl',
  },
  {
    browser: 'Edge',
    os: 'macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.2365.92',
    platform: 'MacIntel',
    expectedEngine: 'Blink',
    expectedMod: 'Cmd',
  },
  {
    browser: 'Edge',
    os: 'Linux',
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.2365.92',
    platform: 'Linux x86_64',
    expectedEngine: 'Blink',
    expectedMod: 'Ctrl',
  },
];

for (const entry of browserMatrix) {
  const b = detectBrowser(entry.ua);
  const p = detectPlatform(entry.ua, entry.platform);

  assert(b.name === entry.browser, `Matrix: ${entry.browser} on ${entry.os} correctly identified as ${entry.browser}`);
  assert(b.engine === entry.expectedEngine, `Matrix: ${entry.browser} engine is ${entry.expectedEngine}`);
  assert(b.isTargetBrowser === true, `Matrix: ${entry.browser} is marked as valid NFR-54 target browser`);
  assert(p.os === entry.os, `Matrix: OS identified as ${entry.os}`);
  assert(p.isTargetOs === true, `Matrix: ${entry.os} is marked as valid NFR-54 target OS`);

  // Mock standard browser DOM environment for this combination
  const mockEnv = {
    window: {
      ResizeObserver: class MockResizeObserver {},
      HTMLCanvasElement: class MockCanvas {},
      Worker: class MockWorker {},
      WebSocket: class MockWebSocket {},
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      crypto: { getRandomValues: (arr) => arr },
      RTCPeerConnection: class MockRTCPeerConnection {},
      AudioContext: class MockAudioContext {},
      Audio: class MockAudio {},
      isSecureContext: true,
    },
    navigator: {
      userAgent: entry.ua,
      platform: entry.platform,
      clipboard: { writeText: async () => true },
      mediaDevices: { getUserMedia: async () => ({}) },
    },
  };

  const audit = checkBrowserSupport(mockEnv);
  assert(audit.isFullySupported === true, `Matrix: ${entry.browser} on ${entry.os} achieves full NFR-54 support status`);
  assert(audit.keyboardShortcuts.modKey === entry.expectedMod, `Matrix: ${entry.os} maps primary modifier to ${entry.expectedMod}`);
  assert(audit.subsystems.editor.isSupported === true, `Matrix: ${entry.browser}/${entry.os} Editor subsystem supported`);
  assert(audit.subsystems.collaboration.isSupported === true, `Matrix: ${entry.browser}/${entry.os} Collaboration subsystem supported`);
  assert(audit.subsystems.voice.isSupported === true, `Matrix: ${entry.browser}/${entry.os} Voice subsystem supported`);
}

// ============================================================================
// Phase 3: Editor Subsystem Invariants & Shortcut Resolution
// ============================================================================
console.log('\n💻 Phase 3: Editor Subsystem Invariants & Shortcut Resolution...');

// Test formatShortcut on Mac vs Windows/Linux
assert(formatShortcut('Enter', { ctrlOrCmd: true, isMac: true }) === 'Cmd+Enter', 'macOS resolves Run shortcut to Cmd+Enter');
assert(formatShortcut('Enter', { ctrlOrCmd: true, isMac: false }) === 'Ctrl+Enter', 'Windows/Linux resolves Run shortcut to Ctrl+Enter');
assert(formatShortcut('S', { ctrlOrCmd: true, isMac: true }) === 'Cmd+S', 'macOS resolves Save shortcut to Cmd+S');
assert(formatShortcut('S', { ctrlOrCmd: true, isMac: false }) === 'Ctrl+S', 'Windows/Linux resolves Save shortcut to Ctrl+S');
assert(formatShortcut('N', { altOrOpt: true, isMac: true }) === 'Opt+N', 'macOS resolves New File shortcut to Opt+N');
assert(formatShortcut('N', { altOrOpt: true, isMac: false }) === 'Alt+N', 'Windows/Linux resolves New File shortcut to Alt+N');

// Test isPrimaryShortcut
const macEvent = { metaKey: true, ctrlKey: false, key: 's' };
const winEvent = { metaKey: false, ctrlKey: true, key: 's' };

// Simulate Mac
assert(isPrimaryShortcut(macEvent, 's', { isMac: true }) === true, 'Mac matches Cmd+S');
assert(isPrimaryShortcut(winEvent, 's', { isMac: true }) === false, 'Mac rejects Ctrl+S without metaKey');

// Simulate Windows
assert(isPrimaryShortcut(winEvent, 's', { isMac: false }) === true, 'Windows matches Ctrl+S');
assert(isPrimaryShortcut(macEvent, 's', { isMac: false }) === false, 'Windows rejects Cmd+S');

// Test safeCopyToClipboard with mock clipboard
const testText = 'https://collabide.test/room/1234';
const mockClipboardEnv = {
  navigator: {
    clipboard: {
      writeText: async (t) => {
        assert(t === testText, 'Clipboard API receives exact text payload');
        return true;
      },
    },
  },
};
const copyResult = await safeCopyToClipboard(testText, mockClipboardEnv);
assert(copyResult === true, 'safeCopyToClipboard succeeds via navigator.clipboard');

// ============================================================================
// Phase 4: Collaboration Subsystem Invariants (Yjs CRDT & Binary Frames)
// ============================================================================
console.log('\n🤝 Phase 4: Collaboration Subsystem Invariants (Yjs CRDT & Binary Frames)...');

// Verify Yjs document update encoding & decoding over Uint8Array binary format
const docA = new Y.Doc();
const docB = new Y.Doc();

const ytextA = docA.getText('room-doc');
const ytextB = docB.getText('room-doc');

ytextA.insert(0, '// Hello cross-browser world from Chrome');
const binaryUpdate = Y.encodeStateAsUpdate(docA);

assert(binaryUpdate instanceof Uint8Array, 'Yjs updates encoded into standard Uint8Array binary buffers');
assert(binaryUpdate.byteLength > 0, 'Binary update buffer contains non-zero byte length');

Y.applyUpdate(docB, binaryUpdate);
assert(ytextB.toString() === '// Hello cross-browser world from Chrome', 'Peer Y.Doc successfully merged binary update across simulated browsers');

// Test concurrent edits merge idempotently
ytextA.insert(ytextA.length, '\nfunction run() { return 42; }');
ytextB.insert(0, '/* Top Banner */\n');

const updateA2 = Y.encodeStateAsUpdate(docA);
const updateB2 = Y.encodeStateAsUpdate(docB);

Y.applyUpdate(docB, updateA2);
Y.applyUpdate(docA, updateB2);

assert(docA.getText('room-doc').toString() === docB.getText('room-doc').toString(), 'Both simulated browser Y.Docs reach identical convergence');

// ============================================================================
// Phase 5: Voice Subsystem Invariants & Autoplay Policy Resilience
// ============================================================================
console.log('\n🎙️  Phase 5: Voice Subsystem Invariants & Autoplay Policy Resilience...');

// Simulate Autoplay Policy Rejection & Recovery
let playCalled = false;
let unlockTriggered = false;

const mockAudioElement = {
  play: async () => {
    if (!playCalled) {
      playCalled = true;
      const notAllowed = new Error('play() failed because the user didn\'t interact with the document first.');
      notAllowed.name = 'NotAllowedError';
      throw notAllowed;
    }
    unlockTriggered = true;
    return Promise.resolve();
  },
};

// Setup mock window with event listeners
const windowListeners = new Map();
const mockWindow = {
  addEventListener: (type, handler, opts) => {
    windowListeners.set(type, handler);
  },
  removeEventListener: (type, handler) => {
    windowListeners.delete(type);
  },
};

await playRemoteAudioSafely(mockAudioElement, { window: mockWindow });
assert(playCalled === true, 'playRemoteAudioSafely attempted audio.play()');
assert(windowListeners.has('click'), 'playRemoteAudioSafely registered click event listener upon NotAllowedError');
assert(windowListeners.has('keydown'), 'playRemoteAudioSafely registered keydown event listener upon NotAllowedError');
assert(windowListeners.has('touchstart'), 'playRemoteAudioSafely registered touchstart event listener upon NotAllowedError');

// Simulate user interaction gesture unlocking audio
const unlockHandler = windowListeners.get('click');
if (unlockHandler) unlockHandler();

assert(unlockTriggered === true, 'Simulated user interaction successfully unlocked and played remote audio');

// Check missing audio capabilities reporting
const degradedEnv = {
  window: {
    ResizeObserver: class MockRO {},
    HTMLCanvasElement: class MockC {},
    Worker: class MockW {},
    WebSocket: class MockWS {},
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
    crypto: { getRandomValues: (arr) => arr },
    // Missing RTCPeerConnection and AudioContext
  },
  navigator: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
    platform: 'Win32',
  },
};

const degradedAudit = checkBrowserSupport(degradedEnv);
assert(degradedAudit.isFullySupported === false, 'Browser missing WebRTC is flagged as not fully supported');
assert(degradedAudit.subsystems.voice.isSupported === false, 'Voice subsystem identified as unsupported');
assert(degradedAudit.issues.some((i) => i.includes('Voice requirements missing')), 'Audit issues clearly list missing Voice requirements');

// ============================================================================
// Summary
// ============================================================================
console.log('\n================================================================');
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('================================================================\n');

if (failed > 0) {
  console.error('❌ SOME NFR-54 BROWSER SUPPORT TESTS FAILED!');
  process.exit(1);
} else {
  console.log('🎉 ALL NFR-54 BROWSER SUPPORT REQUIREMENTS SATISFIED!\n');
  process.exit(0);
}
