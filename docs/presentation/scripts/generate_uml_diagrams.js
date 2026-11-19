#!/usr/bin/env node
/**
 * @file generate_uml_diagrams.js
 * @description Generates 7 exhaustive, visually relieving UML & Scrumban diagrams
 * for CollabIDE (covering Phase 1 SRS v1.2, Phase 2 SRS v2.0, and live repository
 * implementation across all team members) using plain, soothing colors and large,
 * readable typography (no tiny elements).
 *
 * Outputs crisp vector SVGs and high-DPI PNGs to docs/presentation/diagrams/.
 *
 * Usage:
 *   node docs/presentation/scripts/generate_uml_diagrams.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(REPO_ROOT, 'docs/presentation/diagrams');
const JIRA_CSV_PATH = path.join(REPO_ROOT, 'docs/04_status/jira_scrumban_import.csv');

// Canvas matched to 5:3 (1600x960) so it fills 10"x7.5" PowerPoint content slides cleanly
const W = 1600;
const H = 960;

// Plain, simple, visually relieving color palette
const C = {
  bg: '#FFFFFF',
  canvasBorder: '#CBD5E1',
  title: '#0F172A',
  subtitle: '#475569',
  text: '#1E293B',
  muted: '#64748B',
  line: '#475569',
  lineMuted: '#94A3B8',

  blueFill: '#EFF6FF',
  blueHead: '#DBEAFE',
  blueStroke: '#3B82F6',
  blueText: '#1E40AF',

  greenFill: '#F0FDF4',
  greenHead: '#DCFCE7',
  greenStroke: '#16A34A',
  greenText: '#166534',

  amberFill: '#FFFBEB',
  amberHead: '#FEF3C7',
  amberStroke: '#D97706',
  amberText: '#92400E',

  purpleFill: '#F5F3FF',
  purpleHead: '#EDE9FE',
  purpleStroke: '#7C3AED',
  purpleText: '#5B21B6',

  slateFill: '#F8FAFC',
  slateHead: '#E2E8F0',
  slateStroke: '#64748B',
  slateText: '#334155',

  tealFill: '#F0FDFA',
  tealHead: '#CCFBF1',
  tealStroke: '#0D9488',
  tealText: '#115E59',
};

const FONT = "Arial, 'Segoe UI', Helvetica, sans-serif";

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgWrap(title, subtitle, body, width = W, height = H) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${C.line}"/>
    </marker>
    <marker id="arrowBlue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${C.blueStroke}"/>
    </marker>
    <marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${C.greenStroke}"/>
    </marker>
    <marker id="arrowAmber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${C.amberStroke}"/>
    </marker>
    <marker id="arrowPurple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${C.purpleStroke}"/>
    </marker>
    <marker id="openArrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" orient="auto">
      <path d="M 1 1 L 11 6 L 1 11 z" fill="#FFFFFF" stroke="${C.line}" stroke-width="1.8"/>
    </marker>
    <marker id="diamond" viewBox="0 0 14 10" refX="1" refY="5" markerWidth="12" markerHeight="9" orient="auto">
      <path d="M 1 5 L 7 1 L 13 5 L 7 9 z" fill="${C.line}"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="${C.bg}"/>
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="12" fill="${C.bg}" stroke="${C.canvasBorder}" stroke-width="1.5"/>
  <!-- Header Banner -->
  <rect x="10" y="10" width="${width - 20}" height="74" rx="12" fill="${C.slateFill}"/>
  <rect x="10" y="64" width="${width - 20}" height="20" fill="${C.slateFill}"/>
  <line x1="10" y1="84" x2="${width - 10}" y2="84" stroke="${C.canvasBorder}" stroke-width="1.5"/>
  <text x="36" y="44" font-family="${FONT}" font-size="25" font-weight="700" fill="${C.title}">${esc(title)}</text>
  <text x="36" y="69" font-family="${FONT}" font-size="14.5" fill="${C.subtitle}">${esc(subtitle)}</text>
  ${body}
</svg>`;
}

function panel(x, y, w, h, title, theme = 'blue', dashed = false) {
  const fill = C[`${theme}Fill`] || C.slateFill;
  const head = C[`${theme}Head`] || C.slateHead;
  const stroke = C[`${theme}Stroke`] || C.slateStroke;
  const tColor = C[`${theme}Text`] || C.slateText;
  const dash = dashed ? ' stroke-dasharray="8 5"' : '';
  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="2"${dash}/>
    <path d="M ${x + 10} ${y} H ${x + w - 10} Q ${x + w} ${y} ${x + w} ${y + 10} V ${y + 34} H ${x} V ${y + 10} Q ${x} ${y} ${x + 10} ${y} Z" fill="${head}" stroke="${stroke}" stroke-width="1.5"/>
    <text x="${x + 14}" y="${y + 23}" font-family="${FONT}" font-size="16" font-weight="700" fill="${tColor}">${esc(title)}</text>
  </g>`;
}

function box(x, y, w, h, title, lines = [], theme = 'slate', opts = {}) {
  const fill = opts.fill || '#FFFFFF';
  const stroke = C[`${theme}Stroke`] || C.slateStroke;
  const tColor = C[`${theme}Text`] || C.title;
  const dash = opts.dashed ? ' stroke-dasharray="6 4"' : '';
  const titleSize = opts.titleSize || 15;
  const bodySize = opts.bodySize || 13.5;
  const lineH = opts.lineH || 19;

  let textY = y + (lines.length ? 26 : h / 2 + 5);
  let out = `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.8"${dash}/>
    <text x="${x + w / 2}" y="${textY}" text-anchor="middle" font-family="${FONT}" font-size="${titleSize}" font-weight="700" fill="${tColor}">${esc(title)}</text>`;
  if (lines.length) {
    textY += 20;
    for (const line of lines) {
      out += `<text x="${x + w / 2}" y="${textY}" text-anchor="middle" font-family="${FONT}" font-size="${bodySize}" fill="${C.text}">${esc(line)}</text>`;
      textY += lineH;
    }
  }
  out += '</g>';
  return out;
}

function stickActor(cx, cy, name, sub = '', color = C.slateText) {
  return `
  <g>
    <circle cx="${cx}" cy="${cy - 34}" r="14" fill="#FFFFFF" stroke="${color}" stroke-width="2.4"/>
    <line x1="${cx}" y1="${cy - 20}" x2="${cx}" y2="${cy + 14}" stroke="${color}" stroke-width="2.4"/>
    <line x1="${cx - 18}" y1="${cy - 8}" x2="${cx + 18}" y2="${cy - 8}" stroke="${color}" stroke-width="2.4"/>
    <line x1="${cx}" y1="${cy + 14}" x2="${cx - 15}" y2="${cy + 36}" stroke="${color}" stroke-width="2.4"/>
    <line x1="${cx}" y1="${cy + 14}" x2="${cx + 15}" y2="${cy + 36}" stroke="${color}" stroke-width="2.4"/>
    <text x="${cx}" y="${cy + 56}" text-anchor="middle" font-family="${FONT}" font-size="14.5" font-weight="700" fill="${C.title}">${esc(name)}</text>
    ${sub ? `<text x="${cx}" y="${cy + 73}" text-anchor="middle" font-family="${FONT}" font-size="12.5" fill="${C.muted}">${esc(sub)}</text>` : ''}
  </g>`;
}

function useCasePill(cx, cy, rx, ry, line1, line2 = '', theme = 'blue', dashed = false) {
  const fill = C[`${theme}Fill`] || '#FFFFFF';
  const stroke = C[`${theme}Stroke`] || C.slateStroke;
  const dash = dashed ? ' stroke-dasharray="6 4"' : '';
  return `
  <g>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"${dash}/>
    ${line2
      ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="${FONT}" font-size="13.5" font-weight="700" fill="${C.text}">${esc(line1)}</text>
         <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="${FONT}" font-size="12.5" fill="${C.muted}">${esc(line2)}</text>`
      : `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.text}">${esc(line1)}</text>`}
  </g>`;
}

function edgeLabel(x, y, text, color = C.text) {
  const w = Math.max(54, text.length * 7.6 + 18);
  return `
  <g>
    <rect x="${x - w / 2}" y="${y - 12}" width="${w}" height="22" rx="6" fill="#FFFFFF" stroke="${C.canvasBorder}" stroke-width="1"/>
    <text x="${x}" y="${y + 4}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${color}">${esc(text)}</text>
  </g>`;
}

function arrowLine(x1, y1, x2, y2, label = '', opts = {}) {
  const color = opts.color || C.line;
  const marker = opts.marker || 'url(#arrow)';
  const dash = opts.dashed ? ' stroke-dasharray="6 4"' : '';
  let out = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${opts.width || 2}"${dash} marker-end="${marker}"/>`;
  if (label) {
    const lx = opts.lx !== undefined ? opts.lx : (x1 + x2) / 2;
    const ly = opts.ly !== undefined ? opts.ly : (y1 + y2) / 2 - 4;
    out += edgeLabel(lx, ly, label, color);
  }
  return out;
}

function legendBar(items, y = 910) {
  let x = 36;
  let out = `<g>`;
  for (const it of items) {
    const fill = C[`${it.theme}Fill`] || C.slateFill;
    const stroke = C[`${it.theme}Stroke`] || C.slateStroke;
    const dash = it.dashed ? ' stroke-dasharray="5 3"' : '';
    out += `<rect x="${x}" y="${y}" width="20" height="16" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.8"${dash}/>`;
    out += `<text x="${x + 28}" y="${y + 13}" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${C.text}">${esc(it.label)}</text>`;
    x += 44 + it.label.length * 7.7;
  }
  out += `</g>`;
  return out;
}

// ============================================================================
// DIAGRAM 1: UML USE CASE DIAGRAM
// ============================================================================
function buildUseCaseDiagram() {
  let b = '';

  // System Boundary
  b += `<rect x="210" y="102" width="1170" height="786" rx="14" fill="#FFFFFF" stroke="${C.slateStroke}" stroke-width="2.2"/>`;
  b += `<text x="795" y="130" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="700" fill="${C.title}">CollabIDE System Boundary (Phase 1 Implemented + Phase 2 SRS v2.0)</text>`;

  // Left Primary Actors (Human Roles)
  b += stickActor(105, 195, 'Guest', 'Unauthenticated', C.slateText);
  b += stickActor(105, 345, 'Viewer', 'Read-Only Member', C.blueText);
  b += stickActor(105, 495, 'Editor', 'Write & Run Access', C.greenText);
  b += stickActor(105, 645, 'Room Leader', 'Live Access Control', C.amberText);
  b += stickActor(105, 795, 'Room Owner', 'Full Room Authority', C.purpleText);

  // Inheritance arrows between roles (upward generalization)
  b += `<line x1="105" y1="736" x2="105" y2="722" stroke="${C.line}" stroke-width="1.8" marker-end="url(#openArrow)"/>`;
  b += `<line x1="105" y1="586" x2="105" y2="572" stroke="${C.line}" stroke-width="1.8" marker-end="url(#openArrow)"/>`;
  b += `<line x1="105" y1="436" x2="105" y2="422" stroke="${C.line}" stroke-width="1.8" marker-end="url(#openArrow)"/>`;

  // Right External System Actors
  b += box(1410, 170, 155, 78, 'Google / GitHub', ['OAuth 2.0 SSO', '& Repo API'], 'amber', { fill: C.amberFill });
  b += box(1410, 355, 155, 78, 'MongoDB Atlas', ['Encrypted PII,', 'Rooms & Yjs'], 'slate', { fill: C.slateFill });
  b += box(1410, 535, 155, 78, 'Judge0 CE', ['Sandboxed Code', 'Runner (Docker)'], 'amber', { fill: C.amberFill });
  b += box(1410, 715, 155, 78, 'Coturn Server', ['STUN / TURN', 'HMAC Relay'], 'teal', { fill: C.tealFill });

  // 5 Functional Sub-Packages inside System Boundary
  // Package 1: Auth & Identity (Top Left)
  b += panel(235, 150, 545, 225, '1. Authentication & Session Security (FR-01 to FR-09)', 'green');
  b += useCasePill(375, 222, 120, 28, 'Register & Login', 'FR-01, FR-02, OAuth', 'green');
  b += useCasePill(640, 222, 120, 28, 'Silent Refresh & Rotate', 'FR-03, FR-04, NFR-13', 'green');
  b += useCasePill(375, 294, 120, 28, 'Password Reset (30m)', 'FR-09 RS256 Signed', 'green');
  b += useCasePill(640, 294, 120, 28, 'Profile & Active Sessions', 'FR-06, FR-07, FR-08', 'green');
  b += `<text x="507" y="362" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${C.greenText}">Includes: Atomic Lockout (NFR-14), CSRF (NFR-15), AES-256-GCM (NFR-22)</text>`;

  // Package 2: Rooms, Roles & Snapshots (Top Right)
  b += panel(805, 150, 550, 225, '2. Rooms, Live Access Control & Snapshots (FR-10–15, 37–44)', 'blue');
  b += useCasePill(945, 222, 122, 28, 'Create / Close / Delete', 'FR-10, FR-15, Dashboard', 'blue');
  b += useCasePill(1215, 222, 122, 28, 'Join via Invite Link', 'FR-11 (Default Viewer)', 'blue');
  b += useCasePill(945, 294, 122, 28, 'Grant / Revoke Edit Role', 'FR-39 to FR-44 (Live)', 'blue');
  b += useCasePill(1215, 294, 122, 28, 'Save & Restore Snapshot', 'FR-37, FR-38 (Last 20)', 'blue');
  b += `<text x="1080" y="362" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${C.blueText}">Includes: Single Room Leader Invariant, Atomic bulkWrite, Session Reset on Restore</text>`;

  // Package 3: Real-Time CRDT Editing & Chat (Middle Left)
  b += panel(235, 398, 545, 225, '3. Real-Time CRDT Editing, Files & Chat (FR-16–26, 34–36, 54–57)', 'blue');
  b += useCasePill(375, 470, 120, 28, 'Simultaneous Edit (Yjs)', 'FR-16, FR-17, Monaco', 'blue');
  b += useCasePill(640, 470, 120, 28, 'Multi-File Tree & Export', 'FR-21, FR-54 to FR-57', 'blue');
  b += useCasePill(375, 542, 120, 28, 'Cursors & Theme / Font', 'FR-18, FR-23 to FR-26', 'blue');
  b += useCasePill(640, 542, 120, 28, 'Real-Time Room Chat', 'FR-34 to FR-36 (Cap 200)', 'blue');
  b += `<text x="507" y="610" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${C.blueText}">Enforced by: YjsUpdateGuard (NFR-18 Viewer Read-Only), 20 WS/Room Limit (NFR-36)</text>`;

  // Package 4: Sandboxed Execution & WebRTC Voice (Middle Right)
  b += panel(805, 398, 550, 225, '4. Sandboxed Execution & WebRTC Voice (FR-27–33, FR-45–53)', 'teal');
  b += useCasePill(945, 470, 122, 28, 'Run Code (5 Langs+STDIN)', 'FR-27 to FR-32, Judge0', 'teal');
  b += useCasePill(1215, 470, 122, 28, 'HTML/CSS Live Preview', 'FR-33 Client Iframe', 'teal');
  b += useCasePill(945, 542, 122, 28, 'Join / Leave / Mute Voice', 'FR-45 to FR-47, FR-52', 'teal');
  b += useCasePill(1215, 542, 122, 28, 'Leader Mute / Hard Mute', 'FR-48 to FR-51, FR-53', 'teal');
  b += `<text x="1080" y="610" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${C.tealText}">Enforced by: Viewer 403 Exec Gate, 10s/128MB Sandbox Caps, DTLS-SRTP P2P Audio</text>`;

  // Package 5: Phase 2 Cloud IDE & 100k Scale (Bottom Full Width)
  b += panel(235, 646, 1120, 220, '5. Phase 2 Cloud IDE & Enterprise Scale Extensions (SRS v2.0: FR-58 to FR-62, SDR-01 to SDR-05)', 'purple', true);
  b += useCasePill(355, 725, 105, 28, 'GitHub Repo Clone', 'FR-58 Streaming', 'purple', true);
  b += useCasePill(580, 725, 105, 28, 'Web Terminal PTY', 'FR-59 xterm.js', 'purple', true);
  b += useCasePill(805, 725, 105, 28, 'Monaco LSP Bridge', 'FR-60 IntelliSense', 'purple', true);
  b += useCasePill(1025, 725, 105, 28, 'Visual Git & Diff UI', 'FR-61 Stage/Commit', 'purple', true);
  b += useCasePill(1245, 725, 100, 28, 'Live Port Preview', 'FR-62 Proxy Iframe', 'purple', true);
  b += useCasePill(540, 808, 175, 26, 'RS256 60s WS Ticket Auth', 'SDR-01 Control/Data Split', 'purple', true);
  b += useCasePill(1020, 808, 190, 26, '100k Ring-Hash Scale & Telemetry', 'SDR-02–05, NFR-56–62', 'purple', true);

  // Clean Actor-to-Package Associations (Left)
  b += `<line x1="150" y1="195" x2="235" y2="215" stroke="${C.slateStroke}" stroke-width="2"/>`;
  b += `<line x1="150" y1="345" x2="235" y2="495" stroke="${C.blueStroke}" stroke-width="2"/>`;
  b += `<line x1="150" y1="345" x2="235" y2="295" stroke="${C.blueStroke}" stroke-width="1.6" stroke-dasharray="5 4"/>`;
  b += `<line x1="150" y1="495" x2="235" y2="470" stroke="${C.greenStroke}" stroke-width="2.2"/>`;
  b += `<line x1="150" y1="495" x2="235" y2="725" stroke="${C.purpleStroke}" stroke-width="1.6" stroke-dasharray="5 4"/>`;
  b += `<line x1="150" y1="645" x2="210" y2="645" stroke="${C.amberStroke}" stroke-width="2.2"/>`;
  b += `<line x1="150" y1="795" x2="210" y2="795" stroke="${C.purpleStroke}" stroke-width="2.2"/>`;

  // Clean Right External System Associations
  b += `<line x1="1380" y1="210" x2="1410" y2="210" stroke="${C.amberStroke}" stroke-width="2"/>`;
  b += `<line x1="1380" y1="394" x2="1410" y2="394" stroke="${C.slateStroke}" stroke-width="2"/>`;
  b += `<line x1="1380" y1="574" x2="1410" y2="574" stroke="${C.amberStroke}" stroke-width="2"/>`;
  b += `<line x1="1380" y1="754" x2="1410" y2="754" stroke="${C.tealStroke}" stroke-width="2"/>`;

  b += legendBar([
    { theme: 'green', label: 'Phase 1 Auth & Security (Implemented)' },
    { theme: 'blue', label: 'Phase 1 Collaboration & Rooms (Implemented)' },
    { theme: 'teal', label: 'Phase 1 Execution & Voice (Implemented)' },
    { theme: 'purple', label: 'Phase 2 SRS v2.0 Cloud IDE & 100k Scale (Planned)', dashed: true },
  ], 908);

  return svgWrap(
    'UML Use Case Diagram — CollabIDE Full System Scope',
    'Actors, RBAC hierarchy (Owner > Room Leader > Editor > Viewer), implemented Phase 1 capabilities, and Phase 2 SRS v2.0 extensions',
    b
  );
}

// ============================================================================
// DIAGRAM 2: UML COMPONENT & DEPLOYMENT ARCHITECTURE DIAGRAM
// ============================================================================
function buildArchitectureDiagram() {
  let b = '';

  // Tier 1: Client Browser Tier
  b += panel(36, 102, 1528, 138, 'Tier 1 — Client Browser (React 19 + Vite, Zero-Install Native Web Standards — NFR-44, NFR-54, NFR-55)', 'blue');
  b += box(60, 148, 330, 78, 'Monaco Editor + Yjs CRDT', ['y-monaco, Binary Uint8Array Sync', 'Theme/Font Prefs, Ctrl+S Snapshots'], 'blue');
  b += box(420, 148, 330, 78, 'REST API Client (api.js)', ['In-Memory JWT, Refresh Mutex', 'Double-Submit X-CSRF-Token'], 'green');
  b += box(780, 148, 340, 78, 'Native WebRTC Voice Engine', ['useVoiceRoom, 3x ICE Restart', 'DTLS-SRTP Audio, Socket.IO /voice'], 'teal');
  b += box(1150, 148, 390, 78, 'Phase 2 Cloud IDE Modules (SRS v2.0)', ['xterm.js PTY Terminal, Monaco LSP', 'Visual Git Diff UI, Virtualized Tree'], 'purple', { dashed: true, fill: C.purpleFill });

  // Tier 2: Edge / Ingress Tier
  b += panel(36, 276, 1528, 128, 'Tier 2 — Network Edge & Ingress (Phase 1 Nginx TLS Reverse Proxy  |  Phase 2 AWS NLB + Envoy Ring-Hash)', 'amber');
  b += box(60, 322, 470, 68, 'Nginx Reverse Proxy (Phase 1 — NFR-33, NFR-41, NFR-42)', ['TLSv1.2/1.3, 1y Immutable Static (.br/.gz), 24h WS Proxy, limit_req'], 'amber');
  b += box(565, 322, 470, 68, 'AWS NLB (L4) + Envoy Fleet (Phase 2 — SDR-02, SDR-04)', ['Consistent Ring-Hash on ?roomId=, 1000 conn/s Token Bucket'], 'purple', { dashed: true, fill: C.purpleFill });
  b += box(1070, 322, 470, 68, 'Coturn STUN / TURN Infrastructure (NFR-29, NFR-30)', ['Ephemeral 1h HMAC Credentials, NAT Traversal (UDP/TCP 443)'], 'teal');

  // Tier 3: Application Tier (Control Plane vs Data Plane)
  b += panel(36, 444, 1528, 228, 'Tier 3 — Modular Stateless Backend (Node.js + Express, PM2 Cluster Mode — NFR-32, NFR-48, NFR-51, SDR-01)', 'green');

  // Sub-box Control Plane (Left)
  b += panel(60, 488, 725, 168, 'Control Plane — Stateless REST API Modules (Helmet NFR-28, Rate Limit NFR-35)', 'green');
  b += box(78, 532, 215, 108, 'auth Module', ['RS256 JWT (15m)', 'Bcrypt RTR (7d)', 'Atomic Lockout', '30m Reset Links'], 'green');
  b += box(312, 532, 215, 108, 'rooms Module', ['RBAC Hierarchy', 'Atomic bulkWrite', '20 Snapshots', 'DB Isolation'], 'blue');
  b += box(546, 532, 222, 108, 'infra & execution', ['GET /health, Env', 'AES-256-GCM', 'Judge0 Proxy', 'Log Redactor'], 'slate');

  // Sub-box Data Plane (Right)
  b += panel(815, 488, 725, 168, 'Data Plane — Real-Time Sync & Signalling (NFR-52, NFR-53, SDR-01)', 'blue');
  b += box(833, 532, 225, 108, 'websocket-relay', ['RS256 Upgrade', 'YjsUpdateGuard', '20 WS/Room Cap', 'setNoDelay(true)'], 'blue');
  b += box(1076, 532, 220, 108, 'RoomManager', ['Isolated Y.Doc', '2s/10s DB Flush', '30m Idle Sweep', 'Cluster Presence'], 'blue');
  b += box(1314, 532, 208, 108, 'voice-signalling', ['Socket.IO /voice', 'SDP / ICE Relay', 'Leader Mute Ctrl', 'PubSub Adapter'], 'teal');

  // Tier 4: Persistence, Messaging, Sandbox & Observability
  b += panel(36, 712, 1528, 178, 'Tier 4 — Persistence, Off-Hot-Path Messaging, Compute Sandbox & Observability', 'slate');
  b += box(60, 758, 355, 114, 'MongoDB Atlas (NFR-40)', ['Mongoose Pool (min:5, max:20)', 'AES-256-GCM + Blind Indexes', 'Canonical Y.Doc + Snapshots'], 'slate');
  b += box(440, 758, 355, 114, 'Redis Pub/Sub & Sharding', ['Phase 1: RedisPubSubAdapter', 'Cluster Presence & Heartbeats', 'Phase 2: Off-Hot-Path + BullMQ'], 'purple', { fill: C.purpleFill });
  b += box(820, 758, 355, 114, 'Execution & Workspace Sandbox', ['Phase 1: Judge0 CE (10s/128MB)', '15s AbortSignal, Base64+STDIN', 'Phase 2: cgroups PTY/LSP Pods'], 'amber');
  b += box(1200, 758, 340, 114, 'Deployment & Observability', ['Profile A: Docker / Render+Vercel', 'Profile B: AWS EKS + HPA (100k)', 'PM2 Logs, Prometheus + Grafana'], 'teal');

  // Vertical Tier Connections
  b += arrowLine(225, 226, 225, 322, 'WSS / HTTPS', { color: C.blueStroke, marker: 'url(#arrowBlue)', ly: 264 });
  b += arrowLine(585, 226, 460, 322, 'REST + CSRF', { color: C.greenStroke, marker: 'url(#arrowGreen)', lx: 522, ly: 264 });
  b += arrowLine(950, 226, 1210, 322, 'UDP / SRTP', { color: C.tealStroke, marker: 'url(#arrow)', lx: 990, ly: 256 });
  b += arrowLine(1345, 226, 860, 322, 'Ticket WS (P2)', { color: C.purpleStroke, marker: 'url(#arrowPurple)', dashed: true, lx: 1210, ly: 256 });

  b += arrowLine(300, 390, 300, 488, '/api/* & /health', { color: C.greenStroke, marker: 'url(#arrowGreen)', ly: 430 });
  b += arrowLine(795, 390, 945, 488, '/ws/:uuid (Ring-Hash P2)', { color: C.blueStroke, marker: 'url(#arrowBlue)', lx: 885, ly: 430 });
  b += arrowLine(1280, 390, 1418, 532, '/voice', { color: C.tealStroke, marker: 'url(#arrow)', lx: 1375, ly: 430 });

  b += arrowLine(235, 640, 235, 758, 'Mongoose Pool', { color: C.slateStroke, ly: 696 });
  b += arrowLine(650, 640, 950, 758, 'Judge0 API / Queue', { color: C.amberStroke, marker: 'url(#arrowAmber)', lx: 875, ly: 696 });
  b += arrowLine(1180, 640, 620, 758, 'collab:cluster:presence', { color: C.purpleStroke, marker: 'url(#arrowPurple)', lx: 1110, ly: 682 });
  b += arrowLine(1120, 640, 355, 758, 'Debounced Y.Doc Flush', { color: C.blueStroke, marker: 'url(#arrowBlue)', lx: 510, ly: 696 });
  b += arrowLine(1420, 640, 1370, 758, '/metrics & logs', { color: C.tealStroke, lx: 1415, ly: 696 });

  b += legendBar([
    { theme: 'green', label: 'Implemented Phase 1 Control Plane' },
    { theme: 'blue', label: 'Implemented Phase 1 Real-Time Data Plane' },
    { theme: 'amber', label: 'Edge Proxy & Sandboxed Compute' },
    { theme: 'purple', label: 'Phase 2 SRS v2.0 Enterprise Scale Extensions (Dashed)', dashed: true },
  ], 908);

  return svgWrap(
    'UML Component & Deployment Architecture — CollabIDE',
    'Four-tier modular architecture illustrating Phase 1 production infrastructure and Phase 2 100k-concurrency distributed evolution',
    b
  );
}

// ============================================================================
// DIAGRAM 3: UML CLASS / DOMAIN MODEL DIAGRAM
// ============================================================================
function umlClass(x, y, w, h, stereotype, name, attrs, methods, theme = 'blue') {
  const fill = '#FFFFFF';
  const head = C[`${theme}Head`] || C.slateHead;
  const stroke = C[`${theme}Stroke`] || C.slateStroke;
  const tColor = C[`${theme}Text`] || C.title;

  const headH = stereotype ? 48 : 34;
  const attrH = Math.max(24, attrs.length * 18 + 12);
  let out = `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <path d="M ${x + 7} ${y} H ${x + w - 7} Q ${x + w} ${y} ${x + w} ${y + 7} V ${y + headH} H ${x} V ${y + 7} Q ${x} ${y} ${x + 7} ${y} Z" fill="${head}" stroke="${stroke}" stroke-width="1.5"/>`;

  if (stereotype) {
    out += `<text x="${x + w / 2}" y="${y + 18}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-style="italic" fill="${tColor}">&lt;&lt;${esc(stereotype)}&gt;&gt;</text>`;
    out += `<text x="${x + w / 2}" y="${y + 39}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${tColor}">${esc(name)}</text>`;
  } else {
    out += `<text x="${x + w / 2}" y="${y + 23}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${tColor}">${esc(name)}</text>`;
  }

  let cy = y + headH + 18;
  for (const a of attrs) {
    out += `<text x="${x + 12}" y="${cy}" font-family="${FONT}" font-size="13.5" fill="${C.text}">${esc(a)}</text>`;
    cy += 18;
  }

  const sepY = y + headH + attrH;
  out += `<line x1="${x}" y1="${sepY}" x2="${x + w}" y2="${sepY}" stroke="${stroke}" stroke-width="1.2"/>`;

  let my = sepY + 19;
  for (const m of methods) {
    out += `<text x="${x + 12}" y="${my}" font-family="${FONT}" font-size="13.5" fill="${C.slateText}">${esc(m)}</text>`;
    my += 18;
  }

  out += `</g>`;
  return out;
}

function buildClassDiagram() {
  let b = '';

  // Row 1: Persistence Models (MongoDB / Mongoose)
  b += umlClass(36, 118, 345, 264, 'Mongoose Model', 'User', [
    '+ _id: ObjectId',
    '+ email: String (AES-256-GCM)',
    '+ emailHash: String (HMAC Index)',
    '+ password: String (bcrypt ≥ 12)',
    '+ displayName / avatarColor: String',
    '+ theme / fontSize: String / Number',
    '+ loginAttempts / lockUntil: Num/Date',
    '+ resetPasswordToken / Expires',
  ], [
    '+ findByEmail(email): Promise<User>',
    '+ comparePassword(pw): Boolean',
  ], 'green');

  b += umlClass(425, 114, 330, 232, 'Mongoose Model', 'RefreshToken', [
    '+ _id: ObjectId',
    '+ token: String (bcrypt hash)',
    '+ user: ObjectId (ref User)',
    '+ familyId: UUID (indexed)',
    '+ isRotated: Boolean',
    '+ deviceInfo: String (AES-GCM)',
    '+ expiresAt: Date (7d TTL)',
  ], [
    '+ generate(userId, familyId)',
    '+ hashToken(raw): String',
  ], 'green');

  b += umlClass(425, 354, 330, 158, 'Mongoose Model', 'IpBlock', [
    '+ ip: String (AES-256-GCM)',
    '+ ipHash: String (HMAC Index)',
    '+ failedAttempts: Number',
    '+ blockUntil: Date (1h Block)',
  ], [
    '+ atomicIncrement(ip): IpBlock',
  ], 'amber');

  b += umlClass(800, 118, 370, 278, 'Mongoose Model', 'Room', [
    '+ _id: ObjectId',
    '+ uuid: UUID v4 (unique index)',
    '+ name: String (text index)',
    '+ owner: ObjectId (ref User)',
    '+ participants: Participant[]',
    '+ files: FileItem[]',
    '+ ydocState: Buffer (Canonical CRDT)',
    '+ snapshots: Snapshot[] (max 20)',
    '+ executionHistory: ExecResult[] (20)',
    '+ isClosed: Boolean',
  ], [
    '+ preSaveSeedCanonicalYdoc()',
  ], 'blue');

  b += umlClass(1215, 118, 345, 166, 'Subdocument', 'Participant & Snapshot', [
    'Participant: { user, role }',
    '  role ∈ {Owner, Leader, Editor, Viewer}',
    'FileItem: { name, language, content }',
    'Snapshot: { createdAt, ydocState }',
  ], [
    'ExecutionResult: { stdout, stderr, time }',
  ], 'blue');

  // Row 2: Runtime Real-Time & Scaling Classes
  b += umlClass(36, 520, 390, 360, 'Service Singleton', 'RoomManager', [
    '+ rooms: Map<uuid, RoomSession>',
    '+ nodeId: String',
    '+ pubsubAdapter: PubSubAdapter',
    '+ clusterConnections: Map<key, Conn>',
    '+ nodeHeartbeats: Map<nodeId, ts>',
    '+ clusterPresenceChannel: String',
  ], [
    '+ getOrCreateRoom(uuid): RoomSession',
    '+ getRoomConnectionCount(uuid): Num',
    '+ getPresenceMap(): Map<uuid, Set>',
    '+ handleClusterPresenceMessage(msg)',
    '+ persistAllRooms(): Promise<void>',
    '+ sweepInactiveRooms(30m): void',
    '+ destroy(): void',
  ], 'blue');

  b += umlClass(468, 520, 355, 360, 'Domain Entity', 'RoomSession', [
    '+ roomUuid: String',
    '+ ydoc: Y.Doc (Isolated CRDT)',
    '+ clients: Set<WebSocket> (max 20)',
    '+ saveTimer / lastSaveTime',
    '+ snapshotTimer (10m interval)',
    '+ isSaving / isDestroyed: Boolean',
  ], [
    '+ addClient(ws, user, role): void',
    '+ removeClient(ws): Number',
    '+ handleMessage(ws, rawData): void',
    '+ scheduleSave(): void (2s / 10s max)',
    '+ saveToDB(): Promise<void>',
    '+ updateClientRole(userId, role)',
    '+ destroy(skipPersistence): Promise',
  ], 'blue');

  b += umlClass(905, 520, 325, 225, 'Security Guard', 'YjsUpdateGuard', [
    '+ MAX_CHAT_MESSAGE_LENGTH = 2000',
    '+ MAX_CHAT_HISTORY = 200',
    '+ CHAT_TRIM_ORIGIN = server:chat-trim',
  ], [
    '+ inspectUpdate(buf, ydoc): Report',
    '+ validateChatEntry(entry, id): Err?',
    '+ evaluateUpdate(buf, ydoc, ctx)',
    '+ trimChatHistory(ydoc, uuid): Num',
  ], 'amber');

  b += umlClass(1265, 310, 295, 175, 'Abstract Class', 'PubSubAdapter (NFR-53)', [
    '+ name: String',
  ], [
    '+ publish(channel, msg): Promise',
    '+ subscribe(channel, fn): Promise',
    '+ unsubscribe(channel, fn): Promise',
    '+ close(): Promise<void>',
  ], 'purple');

  b += umlClass(1265, 520, 295, 148, 'Concrete Adapter', 'MemoryPubSubAdapter', [
    '+ emitter: EventEmitter',
    '+ subscriptions: Map',
  ], [
    '+ publish() [async JSON clone]',
    '+ subscribe() / close()',
  ], 'purple');

  b += umlClass(1265, 700, 295, 152, 'Concrete Adapter', 'RedisPubSubAdapter', [
    '+ pubClient / subClient',
    '+ channelPrefix: "collab:"',
  ], [
    '+ publish() [binary/JSON]',
    '+ subscribe() / attachSocketIO()',
  ], 'purple');

  // UML Relationships
  // User 1 -- 0..* RefreshToken
  b += arrowLine(381, 200, 425, 200, '1 .. *', { color: C.greenStroke, marker: 'url(#arrowGreen)', ly: 184 });
  // User 1 -- 0..* Room (owns / participates) routed cleanly above row 1
  b += `<path d="M 208 118 V 97 H 985 V 118" fill="none" stroke="${C.blueStroke}" stroke-width="1.8" marker-end="url(#arrowBlue)"/>`;
  b += edgeLabel(590, 97, 'owns / joins (1..*)', C.blueText);
  // Room *-- Participant / Snapshot (Composition)
  b += `<line x1="1170" y1="195" x2="1215" y2="195" stroke="${C.blueStroke}" stroke-width="2" marker-start="url(#diamond)" marker-end="url(#arrowBlue)"/>`;
  // RoomManager *-- RoomSession (Composition)
  b += `<line x1="426" y1="670" x2="468" y2="670" stroke="${C.blueStroke}" stroke-width="2" marker-start="url(#diamond)" marker-end="url(#arrowBlue)"/>`;
  b += edgeLabel(447, 648, '1..*', C.blueText);
  // RoomSession --> YjsUpdateGuard
  b += arrowLine(823, 625, 905, 625, 'validates', { color: C.amberStroke, marker: 'url(#arrowAmber)', lx: 864, ly: 605 });
  // RoomSession --> Room (persists to)
  b += `<path d="M 823 552 H 860 V 396" fill="none" stroke="${C.blueStroke}" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#arrowBlue)"/>`;
  b += edgeLabel(932, 452, 'persists ydocState', C.blueText);
  // RoomManager --> PubSubAdapter
  b += `<path d="M 426 845 H 1245 V 418 H 1265" fill="none" stroke="${C.purpleStroke}" stroke-width="1.8" marker-end="url(#arrowPurple)"/>`;
  b += edgeLabel(1040, 845, 'uses pubsubAdapter (NFR-53, SDR-01)', C.purpleText);
  // Inheritance: MemoryPubSubAdapter & RedisPubSubAdapter --|> PubSubAdapter
  b += `<line x1="1412" y1="520" x2="1412" y2="485" stroke="${C.purpleStroke}" stroke-width="2" marker-end="url(#openArrow)"/>`;
  b += `<path d="M 1560 775 H 1578 V 395 H 1560" fill="none" stroke="${C.purpleStroke}" stroke-width="2" marker-end="url(#openArrow)"/>`;

  b += legendBar([
    { theme: 'green', label: 'Identity & Session Models' },
    { theme: 'blue', label: 'Room & Real-Time CRDT Domain' },
    { theme: 'amber', label: 'Security Guards & Lockout' },
    { theme: 'purple', label: 'Horizontal Scaling Pub/Sub Hierarchy' },
  ], 908);

  return svgWrap(
    'UML Class & Domain Model Diagram — CollabIDE',
    'Verified Mongoose schemas, runtime RoomManager/RoomSession services, YjsUpdateGuard security boundary, and PubSubAdapter hierarchy',
    b
  );
}

// ============================================================================
// SEQUENCE DIAGRAM HELPER
// ============================================================================
function seqDiagramBase(lifelines, messages, bands = [], height = H) {
  let b = '';
  const topY = 104;
  const botY = height - 66;

  // Lifelines headers & vertical dashed lines
  for (const lf of lifelines) {
    const fill = C[`${lf.theme}Head`] || C.slateHead;
    const stroke = C[`${lf.theme}Stroke`] || C.slateStroke;
    const tColor = C[`${lf.theme}Text`] || C.title;
    b += `<line x1="${lf.x}" y1="${topY + 54}" x2="${lf.x}" y2="${botY}" stroke="${C.lineMuted}" stroke-width="1.8" stroke-dasharray="6 5"/>`;
    b += `<rect x="${lf.x - lf.w / 2}" y="${topY}" width="${lf.w}" height="54" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    b += `<text x="${lf.x}" y="${topY + 23}" text-anchor="middle" font-family="${FONT}" font-size="14.5" font-weight="700" fill="${tColor}">${esc(lf.name)}</text>`;
    if (lf.sub) {
      b += `<text x="${lf.x}" y="${topY + 42}" text-anchor="middle" font-family="${FONT}" font-size="12.5" fill="${C.text}">${esc(lf.sub)}</text>`;
    }
  }

  // Phase / Section bands
  for (const band of bands) {
    const fill = C[`${band.theme}Fill`] || C.slateFill;
    const stroke = C[`${band.theme}Stroke`] || C.slateStroke;
    const tColor = C[`${band.theme}Text`] || C.title;
    const dash = band.dashed ? ' stroke-dasharray="7 5"' : '';
    b += `<rect x="30" y="${band.y}" width="${W - 60}" height="${band.h}" rx="8" fill="${fill}" fill-opacity="0.45" stroke="${stroke}" stroke-width="1.6"${dash}/>`;
    b += `<rect x="30" y="${band.y}" width="${Math.min(820, band.label.length * 8.1 + 32)}" height="26" rx="6" fill="${C[`${band.theme}Head`] || C.slateHead}" stroke="${stroke}" stroke-width="1.2"/>`;
    b += `<text x="42" y="${band.y + 18}" font-family="${FONT}" font-size="13.5" font-weight="700" fill="${tColor}">${esc(band.label)}</text>`;
  }

  // Messages
  const byId = Object.fromEntries(lifelines.map((l) => [l.id, l]));
  for (const m of messages) {
    const a = byId[m.from];
    const z = byId[m.to];
    const color = m.color || C.line;
    const marker = m.marker || 'url(#arrow)';
    const dash = m.dashed ? ' stroke-dasharray="6 4"' : '';

    if (m.from === m.to) {
      // Self-call loop
      b += `<path d="M ${a.x} ${m.y} H ${a.x + 56} V ${m.y + 24} H ${a.x + 4}" fill="none" stroke="${color}" stroke-width="2"${dash} marker-end="${marker}"/>`;
      b += `<rect x="${a.x + 64}" y="${m.y - 2}" width="${m.label.length * 7.6 + 18}" height="24" rx="5" fill="#FFFFFF" stroke="${C.canvasBorder}" stroke-width="1"/>`;
      b += `<text x="${a.x + 73}" y="${m.y + 15}" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${color}">${esc(m.label)}</text>`;
    } else {
      const dir = z.x > a.x ? 1 : -1;
      const x1 = a.x;
      const x2 = z.x - dir * 4;
      b += `<line x1="${x1}" y1="${m.y}" x2="${x2}" y2="${m.y}" stroke="${color}" stroke-width="2"${dash} marker-end="${marker}"/>`;
      const lx = (x1 + x2) / 2;
      b += edgeLabel(lx, m.y - 12, m.label, color);
    }
  }

  return b;
}

// ============================================================================
// DIAGRAM 4: SEQUENCE — AUTH, ROTATION, RESET & PHASE 2 TICKETS
// ============================================================================
function buildSequenceAuthDiagram() {
  const lifelines = [
    { id: 'client', x: 155, w: 195, name: 'Browser Client', sub: 'api.js (In-Memory JWT)', theme: 'blue' },
    { id: 'auth', x: 520, w: 220, name: 'Auth Control Plane', sub: 'routes/auth.js + CSRF', theme: 'green' },
    { id: 'crypto', x: 880, w: 215, name: 'Crypto & Mail', sub: 'RS256 + AES-GCM + Email', theme: 'amber' },
    { id: 'db', x: 1200, w: 205, name: 'MongoDB Atlas', sub: 'User / RefreshToken / IP', theme: 'slate' },
    { id: 'ws', x: 1465, w: 185, name: 'Realtime Pod', sub: 'RS256 Public Key Only', theme: 'purple' },
  ];

  const bands = [
    { y: 174, h: 210, label: 'Flow 1: Login & Atomic Brute-Force Lockout (FR-02, NFR-14)', theme: 'green' },
    { y: 398, h: 162, label: 'Flow 2: Silent Refresh Rotation & Family Replay Revocation (FR-03, NFR-13)', theme: 'blue' },
    { y: 574, h: 146, label: 'Flow 3: 30-Min RS256 Single-Use Password Reset (FR-09)', theme: 'amber' },
    { y: 734, h: 148, label: 'Flow 4 (Phase 2 SRS v2.0): Control/Data Plane Split — 60s RS256 Ticket (SDR-01)', theme: 'purple', dashed: true },
  ];

  const messages = [
    // Flow 1
    { from: 'client', to: 'auth', y: 222, label: '1. POST /api/auth/login { email, password } + X-CSRF-Token', color: C.greenText, marker: 'url(#arrowGreen)' },
    { from: 'auth', to: 'db', y: 260, label: '2. Check IpBlock (20/10m) & User.findByEmail (HMAC Blind Index)', color: C.line },
    { from: 'auth', to: 'db', y: 298, label: '3a. On fail: Atomic $inc loginAttempts (5/10m -> 15m lock) -> 401/403', color: C.amberText, marker: 'url(#arrowAmber)', dashed: true },
    { from: 'auth', to: 'crypto', y: 336, label: '3b. On valid bcrypt: Sign RS256 Access (15m) + Bcrypt Refresh (7d)', color: C.greenText, marker: 'url(#arrowGreen)' },
    { from: 'auth', to: 'client', y: 368, label: '4. HTTP 200 { accessToken } + HttpOnly SameSite=Strict Cookie', color: C.greenText, marker: 'url(#arrowGreen)', dashed: true },

    // Flow 2
    { from: 'client', to: 'auth', y: 446, label: '5. Mutex refreshPromise -> POST /api/auth/refresh (Cookie + CSRF)', color: C.blueText, marker: 'url(#arrowBlue)' },
    { from: 'auth', to: 'db', y: 486, label: '6. Lookup familyId: if isRotated==true -> DELETE ENTIRE FAMILY (403!)', color: C.amberText, marker: 'url(#arrowAmber)' },
    { from: 'auth', to: 'client', y: 534, label: '7. Mark old rotated, issue child Refresh + new RS256 Access Token', color: C.blueText, marker: 'url(#arrowBlue)', dashed: true },

    // Flow 3
    { from: 'client', to: 'auth', y: 622, label: '8. POST /reset-password-request -> SHA-256(jti) in DB + 30m RS256 Link', color: C.amberText, marker: 'url(#arrowAmber)' },
    { from: 'auth', to: 'crypto', y: 660, label: '9. sendPasswordResetEmail() -> Verify RS256 + Single-Use DB Hash', color: C.amberText, marker: 'url(#arrowAmber)' },
    { from: 'auth', to: 'db', y: 698, label: '10. Update bcrypt password, wipe resetToken, DELETE 100% RefreshTokens', color: C.greenText, marker: 'url(#arrowGreen)' },

    // Flow 4 (Phase 2)
    { from: 'client', to: 'auth', y: 782, label: '11. POST /api/workspaces/:id/ticket (Validates JWT + DB Role once)', color: C.purpleText, marker: 'url(#arrowPurple)', dashed: true },
    { from: 'auth', to: 'client', y: 818, label: '12. Return 60s RS256 Ticket { sub, roomId, role, exp=iat+60 }', color: C.purpleText, marker: 'url(#arrowPurple)', dashed: true },
    { from: 'client', to: 'ws', y: 856, label: '13. WSS Connect ?ticket=<JWT> -> Local Public Key Verify (0 DB Queries!)', color: C.purpleText, marker: 'url(#arrowPurple)', dashed: true },
  ];

  let b = seqDiagramBase(lifelines, messages, bands);
  b += legendBar([
    { theme: 'green', label: 'Implemented Login & Atomic Lockout' },
    { theme: 'blue', label: 'Implemented RTR Replay Protection' },
    { theme: 'amber', label: 'Implemented 30m RS256 Reset Flow' },
    { theme: 'purple', label: 'Phase 2 SRS v2.0 Zero-DB Ticket Auth', dashed: true },
  ], 908);

  return svgWrap(
    'UML Sequence Diagram — Authentication, Token Rotation & RS256 Ticket Auth',
    'End-to-end security flows across Phase 1 implemented authentication and Phase 2 thundering-herd-proof Data Plane tickets',
    b
  );
}

// ============================================================================
// DIAGRAM 5: SEQUENCE — CRDT SYNC, YJS GUARD, ROLES & SNAPSHOTS
// ============================================================================
function buildSequenceCrdtDiagram() {
  const lifelines = [
    { id: 'editor', x: 145, w: 185, name: 'Editor / Viewer', sub: 'Monaco + y-websocket', theme: 'blue' },
    { id: 'leader', x: 425, w: 190, name: 'Owner / Leader', sub: 'WorkspaceView UI', theme: 'purple' },
    { id: 'relay', x: 745, w: 225, name: 'WS Relay & Guard', sub: 'yjsUpdateGuard + RoomMgr', theme: 'amber' },
    { id: 'ydoc', x: 1085, w: 205, name: 'In-Memory Y.Doc', sub: 'Isolated RoomSession', theme: 'green' },
    { id: 'db', x: 1425, w: 215, name: 'MongoDB + Pub/Sub', sub: 'Room.ydocState & Cluster', theme: 'slate' },
  ];

  const bands = [
    { y: 174, h: 158, label: 'Phase A: Authenticated WebSocket Handshake & Cluster Presence (NFR-17, NFR-36, SDR-01)', theme: 'blue' },
    { y: 346, h: 202, label: 'Phase B: Real-Time CRDT Edit, YjsUpdateGuard & Max-Wait Flush (FR-16, FR-34, NFR-08, NFR-18)', theme: 'green' },
    { y: 562, h: 144, label: 'Phase C: Live Role Grant / Revoke without Reconnect (FR-39 to FR-44, NFR-19)', theme: 'amber' },
    { y: 720, h: 162, label: 'Phase D: Manual Snapshot (Ctrl+S) & Clean CRDT Restore (FR-37, FR-38)', theme: 'purple' },
  ];

  const messages = [
    // Phase A
    { from: 'editor', to: 'relay', y: 224, label: '1. WSS Upgrade /ws/:roomUuid?token=JWT (setNoDelay=true)', color: C.blueText, marker: 'url(#arrowBlue)' },
    { from: 'relay', to: 'relay', y: 252, label: '2. Verify RS256 + Check Cluster Count < 20 (else Close 1008)' },
    { from: 'relay', to: 'db', y: 306, label: '3. Hydrate Canonical ydocState + Publish presence_join', color: C.blueText, marker: 'url(#arrowBlue)' },

    // Phase B
    { from: 'editor', to: 'relay', y: 396, label: '4. Binary Yjs SyncStep2 / Update Frame (<= 512KB, <= 300 msg/s)', color: C.greenText, marker: 'url(#arrowGreen)' },
    { from: 'relay', to: 'ydoc', y: 434, label: '5. evaluateUpdate(): Block Viewer file writes/deletes; verify chat userId', color: C.amberText, marker: 'url(#arrowAmber)' },
    { from: 'ydoc', to: 'editor', y: 472, label: '6. Apply CRDT delta, trimChatHistory(200) & Relay to Room Peers', color: C.greenText, marker: 'url(#arrowGreen)', dashed: true },
    { from: 'ydoc', to: 'db', y: 518, label: '7. scheduleSave(): 2s idle debounce OR 10s max-wait throttle -> MongoDB', color: C.slateText },

    // Phase C
    { from: 'leader', to: 'db', y: 612, label: '8. PUT /api/rooms/:uuid/roles -> Atomic Room.bulkWrite(bulkOps)', color: C.amberText, marker: 'url(#arrowAmber)' },
    { from: 'relay', to: 'editor', y: 668, label: '9. updateClientRoleInMemory() FIRST -> Broadcast updated roster event', color: C.amberText, marker: 'url(#arrowAmber)', dashed: true },

    // Phase D
    { from: 'leader', to: 'db', y: 768, label: '10. Ctrl+S -> POST /:uuid/snapshot -> saveToDB() + $push/$slice:-20', color: C.purpleText, marker: 'url(#arrowPurple)' },
    { from: 'leader', to: 'relay', y: 812, label: '11. POST /:uuid/snapshots/:id/restore -> Overwrite ydocState in DB', color: C.purpleText, marker: 'url(#arrowPurple)' },
    { from: 'relay', to: 'editor', y: 856, label: '12. session.destroy(true) -> Close 1001 -> Clients Re-hydrate Clean State', color: C.purpleText, marker: 'url(#arrowPurple)', dashed: true },
  ];

  let b = seqDiagramBase(lifelines, messages, bands);
  b += legendBar([
    { theme: 'blue', label: 'WS Handshake & Cluster Presence' },
    { theme: 'green', label: 'CRDT Sync & Max-Wait Persistence' },
    { theme: 'amber', label: 'YjsUpdateGuard & Atomic RBAC' },
    { theme: 'purple', label: 'Bounded Snapshots & Clean Rollback' },
  ], 908);

  return svgWrap(
    'UML Sequence Diagram — Real-Time Yjs CRDT Sync, Role Control & Snapshots',
    'Server-authoritative write barriers (YjsUpdateGuard), atomic role swaps, max-wait persistence, and conflict-free snapshot restoration',
    b
  );
}

// ============================================================================
// DIAGRAM 6: SEQUENCE — SANDBOXED EXECUTION & WEBRTC VOICE
// ============================================================================
function buildSequenceExecVoiceDiagram() {
  const lifelines = [
    { id: 'clientA', x: 145, w: 185, name: 'Client A (Editor)', sub: 'Workspace / useVoice', theme: 'blue' },
    { id: 'api', x: 485, w: 215, name: 'Express Backend', sub: 'execution.js / voice.js', theme: 'green' },
    { id: 'judge', x: 830, w: 205, name: 'Judge0 / Coturn', sub: 'Sandbox / STUN+TURN', theme: 'amber' },
    { id: 'socket', x: 1155, w: 200, name: 'WS & Socket.IO', sub: 'Room Relay / /voice', theme: 'teal' },
    { id: 'clientB', x: 1460, w: 195, name: 'Client B (Peer)', sub: 'Room Collaborator', theme: 'purple' },
  ];

  const bands = [
    { y: 174, h: 318, label: 'Flow 1: Sandboxed Multi-Language Code Execution (FR-27–33, NFR-03, NFR-26, NFR-43)', theme: 'amber' },
    { y: 510, h: 372, label: 'Flow 2: Native Zero-Install WebRTC Mesh Voice & ICE Restart (FR-45–53, NFR-06, NFR-10, NFR-44)', theme: 'teal' },
  ];

  const messages = [
    // Execution Flow
    { from: 'clientA', to: 'api', y: 224, label: '1. POST /api/execution/:uuid/run { language, code, stdin }', color: C.blueText, marker: 'url(#arrowBlue)' },
    { from: 'api', to: 'api', y: 252, label: '2. JWT Protect + 10/min User Limiter + Block Viewer (403)' },
    { from: 'api', to: 'judge', y: 312, label: '3. Base64 Submit (10s CPU, 12s Wall, 128MB, 64KB) + 15s AbortSignal', color: C.amberText, marker: 'url(#arrowAmber)' },
    { from: 'judge', to: 'api', y: 356, label: '4. Return Base64 { stdout, stderr, status, time, memory }', color: C.amberText, marker: 'url(#arrowAmber)', dashed: true },
    { from: 'api', to: 'socket', y: 400, label: '5. global.broadcastToRoom({ type: "exec:result", payload })', color: C.greenText, marker: 'url(#arrowGreen)' },
    { from: 'socket', to: 'clientB', y: 432, label: '6. Live Execution Output to All Peers', color: C.greenText, marker: 'url(#arrowGreen)', dashed: true },
    { from: 'api', to: 'clientA', y: 468, label: '7. Immediate HTTP 200 (NFR-03) + Background MongoDB Save (Cap 20)', color: C.greenText, marker: 'url(#arrowGreen)', dashed: true },

    // Voice Flow
    { from: 'clientA', to: 'api', y: 562, label: '8. GET /api/voice/credentials -> Mint 1h Ephemeral HMAC-SHA1 TURN Creds', color: C.tealText },
    { from: 'clientA', to: 'socket', y: 604, label: '9. Socket.IO /voice (RS256 Auth) -> emit("join-room", { roomUuid })', color: C.tealText },
    { from: 'socket', to: 'clientB', y: 642, label: '10. Broadcast "user-joined" + Mute / Leader Hard-Mute State', color: C.tealText, dashed: true },
    { from: 'clientA', to: 'socket', y: 684, label: '11. Relay SDP Offer / Answer & ICE Candidates via /voice', color: C.blueText, marker: 'url(#arrowBlue)' },
    { from: 'socket', to: 'clientB', y: 716, label: '12. Forward SDP & ICE', color: C.blueText, marker: 'url(#arrowBlue)' },
    { from: 'clientA', to: 'clientB', y: 766, label: '13. Direct P2P Encrypted DTLS-SRTP Audio (latency:0, Zero Server Recording!)', color: C.greenText, marker: 'url(#arrowGreen)', width: 2.6 },
    { from: 'clientA', to: 'judge', y: 814, label: '14. Symmetric NAT Fallback: Relay via Coturn TURN over UDP / TCP 443', color: C.amberText, marker: 'url(#arrowAmber)', dashed: true },
    { from: 'clientA', to: 'clientA', y: 838, label: '15. On Drop: Auto ICE Restart (Max 3 Attempts -> Toast / Clean Leave)' },
  ];

  let b = seqDiagramBase(lifelines, messages, bands);
  b += legendBar([
    { theme: 'amber', label: 'Judge0 Sandbox & Coturn TURN Fallback' },
    { theme: 'green', label: 'Fast Non-Blocking Response & Direct P2P Audio' },
    { theme: 'teal', label: 'Socket.IO /voice Signalling & Leader Mute' },
    { theme: 'blue', label: 'HTML/CSS Runs Client-Side in Sandboxed Iframe (Zero Server Load)' },
  ], 908);

  return svgWrap(
    'UML Sequence Diagram — Sandboxed Code Execution & WebRTC Voice Mesh',
    'Resource-capped Judge0 execution with background persistence alongside zero-install DTLS-SRTP WebRTC audio with 3x ICE restart',
    b
  );
}

// ============================================================================
// CSV PARSER FOR JIRA SCRUMBAN IMPORT
// ============================================================================
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ============================================================================
// DIAGRAM 7: SCRUMBAN BOARD (EPICS, USER STORIES & TASKS — REPLACING WBS)
// ============================================================================
function buildScrumbanBoard() {
  const csvRaw = fs.readFileSync(JIRA_CSV_PATH, 'utf8');
  const parsed = parseCsv(csvRaw);
  const dataRows = parsed.slice(1).filter((r) => r.length >= 2 && r[0]);
  const epicsCount = dataRows.filter((r) => r[0].trim() === 'Epic').length;
  const stories = dataRows.filter((r) => r[0].trim() === 'Story');

  // Count Phase 1 Jira stories per Epic
  const epicTallies = {};
  for (const s of stories) {
    const ep = (s[4] || 'Unassigned').trim();
    epicTallies[ep] = (epicTallies[ep] || 0) + 1;
  }

  let b = '';

  // Top Metric Strip (Epics, Stories, Commits, WIP Policy)
  const stats = [
    { label: 'Phase 1 Jira Epics', val: `${epicsCount} Epics`, sub: 'jira_scrumban_import.csv', theme: 'blue' },
    { label: 'Phase 1 User Stories', val: `${stories.length} Stories`, sub: '57 FR + 55 NFR Tracked', theme: 'green' },
    { label: 'Phase 2 SRS v2.0 Scope', val: '16 Stories', sub: '5 SDR + 5 FR + 6 NFR', theme: 'purple' },
    { label: 'Delivered Commits (Team)', val: '220+ Commits', sub: 'Omer · Hamza · Maaz', theme: 'amber' },
  ];
  stats.forEach((st, idx) => {
    const x = 36 + idx * 388;
    b += box(x, 102, 364, 76, `${st.val} — ${st.label}`, [st.sub], st.theme, { fill: C[`${st.theme}Fill`], titleSize: 16 });
  });

  // 4 Scrumban Columns
  // Col 1: Epics & Backlog (Phase 2 SRS v2.0)
  b += panel(36, 198, 368, 686, 'BACKLOG — Phase 2 (SRS v2.0)', 'purple', true);
  b += box(54, 248, 332, 106, 'Epic 7: Distributed Scale (100k)', [
    'SDR-01: Control/Data Plane Tickets',
    'SDR-02: Envoy Ring-Hash & Sharding',
    'SDR-03/04: EKS Helm + AWS NLB L4',
  ], 'purple');
  b += box(54, 370, 332, 106, 'Epic 8: Cloud IDE & Sandbox', [
    'SDR-05: BullMQ + cgroups Runner',
    'FR-58: GitHub OAuth & Repo Clone',
    'FR-59: xterm.js + node-pty Shell',
  ], 'purple');
  b += box(54, 492, 332, 106, 'Epic 9: Code Intelligence & Git', [
    'FR-60: Monaco LSP (TS & Python)',
    'FR-61: Visual Git Status & Diff UI',
    'FR-62: Live Port Forwarding Proxy',
  ], 'purple');
  b += box(54, 614, 332, 122, 'Epic 10: C100K & Observability', [
    'NFR-56: Virtualized 50k File Tree',
    'NFR-58/59: Binary Backpressure',
    'NFR-60/61: Kernel Tuning + Jitter',
    'NFR-62: Distributed k6 + Grafana',
  ], 'purple');
  b += box(54, 752, 332, 112, 'Scrumban Pull Policy', [
    'Pull-based Kanban + Bi-Weekly',
    'Reviews · WIP Limit: 3 Tasks/Dev',
    'Jira CSV + Excel Sync Enabled',
  ], 'slate', { fill: C.slateFill });

  // Col 2: In Review / Feature PR Branches (WIP Limit: 3)
  b += panel(424, 198, 368, 686, 'IN REVIEW — Active PRs (WIP: 3/3)', 'amber');
  b += box(442, 248, 332, 170, 'PR 1: Snapshots & Security', [
    'Branch: feat/fr37-fr38-workspace...',
    'Owner: Omer Siddiqui',
    'Stories: FR-37, FR-38, FR-34, NFR-18',
    'Tasks: 20 Snapshots, Restore UI,',
    'YjsUpdateGuard, Helmet (NFR-28)',
  ], 'amber');
  b += box(442, 436, 332, 170, 'PR 2: Password Reset Suite', [
    'Branch: feat/FR-09-password-reset...',
    'Owner: Hamza Tanveer',
    'Stories: FR-09, NFR-16, NFR-22',
    'Tasks: 30m RS256 Links, email.js,',
    '100% Refresh Wipe, delete_user.js',
  ], 'amber');
  b += box(442, 624, 332, 170, 'PR 3: Shared-Nothing Backend', [
    'Branch: feat/SDR-01-shared-nothing...',
    'Owner: Hamza Tanveer',
    'Stories: SDR-01, NFR-36, NFR-53',
    'Tasks: Canonical Y.Doc Pre-Save,',
    'Cluster Presence Bus, Failover Test',
  ], 'amber');
  b += box(442, 810, 332, 56, 'Merge Readiness Gate', [
    'Reconcile Room.js & roomManager.js',
  ], 'slate', { fill: C.slateFill });

  // Col 3: DONE — Phase 1 Core Product Epics
  b += panel(812, 198, 372, 686, 'DONE — Core Product Epics (Main)', 'green');
  b += box(830, 248, 336, 134, `Epic: Auth (${epicTallies['Auth'] || 15} Jira Stories)`, [
    'FR-01–08, NFR-11–16, Google OAuth',
    'RS256 JWT, Bcrypt RTR, CSRF Double-Sub',
    'Atomic Lockout, Active Sessions, Profile',
    'Team: Omer · Maaz · Hamza',
  ], 'green');
  b += box(830, 400, 336, 146, `Epic: Rooms & Roles (${epicTallies['Rooms & Roles'] || 31} Stories)`, [
    'FR-10–15, FR-34–36, FR-39–57, NFR-29–31',
    'RBAC Hierarchy + Live Grant/Revoke',
    'WebRTC Voice + Leader Mute + ICE Retry',
    'Multi-File CRUD + Search Dashboard',
  ], 'green');
  b += box(830, 564, 336, 140, `Epic: Real-Time Editing (${epicTallies['Real-Time Editing'] || 13} Stories)`, [
    'FR-16–26, NFR-01/04/07/08/09',
    'Yjs CRDT + Monaco + Live Cursors',
    'Dark/Light Themes, Keybindings, Fonts',
    'Team: Omer · Maaz · Hamza',
  ], 'green');
  b += box(830, 722, 336, 142, `Epic: Execution (${epicTallies['Execution'] || 7} Stories)`, [
    'FR-27–33, NFR-03, NFR-26, NFR-43',
    'Judge0 CE (5 Langs + Base64 + STDIN)',
    '15s AbortSignal + HTML/CSS Iframe',
    'Live WS Result Broadcast + Cap 20',
  ], 'green');

  // Col 4: DONE — Infrastructure, Security & Architecture Epics
  b += panel(1204, 198, 360, 686, 'DONE — Infra, Security & Ops (Main)', 'blue');
  b += box(1222, 248, 324, 152, `Epic: Infra & Security (${epicTallies['Infrastructure & Security'] || 43} Stories)`, [
    'NFR-17–28, NFR-32–47, NFR-51–55',
    'PM2 Cluster (512MB) + Log Rotator',
    'Nginx TLS Proxy + Static .br/.gz',
    'AES-256-GCM + 0640 Log Redaction',
  ], 'blue');
  b += box(1222, 418, 324, 142, 'Epic: Modularization & Config', [
    'NFR-48 (6 Independent Modules)',
    'NFR-49 (Fail-Fast Env + Key Rotate)',
    'NFR-50 (JSDoc & Security Contracts)',
    'NFR-51/53 (Stateless + Pub/Sub)',
  ], 'blue');
  b += box(1222, 578, 324, 142, 'Epic: Hardening & Quality', [
    'NFR-25 (DB Tenant Isolation)',
    '9be43a8 (NoSQL + Atomic Races)',
    'NFR-38/39/40 (Shutdown/Health/Pool)',
    '20+ Automated NFR Test Suites',
  ], 'blue');
  b += box(1222, 738, 324, 126, 'Team Ownership Summary', [
    'Omer Siddiqui: Core IDE, Sync, UI, Sec',
    'Hamza Tanveer: Modules, Scale, Crypto',
    'Maaz Ahmed: PM2, Nginx, Lockout, Docs',
  ], 'teal', { fill: C.tealFill });

  b += legendBar([
    { theme: 'green', label: 'Done — Core Product Epics on main' },
    { theme: 'blue', label: 'Done — Infrastructure & Security on main' },
    { theme: 'amber', label: 'In Review — Unmerged Feature PR Branches' },
    { theme: 'purple', label: 'Backlog — Phase 2 SRS v2.0 Epics', dashed: true },
  ], 908);

  return svgWrap(
    'Scrumban Breakdown — Epics, User Stories & Tasks (Replacing WBS / Gantt)',
    'Tracked directly from docs/04_status/jira_scrumban_import.csv, Git repository history (all 3 members), and Phase 2 SRS v2.0',
    b
  );
}

// ============================================================================
// SVG -> HIGH-DPI PNG RENDERING VIA HEADLESS CHROME / EDGE
// ============================================================================
function findChromium() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function renderSvgToPng(chromiumPath, svgPath, pngPath, width = W, height = H) {
  const fileUrl = 'file:///' + svgPath.replace(/\\/g, '/');
  execFileSync(
    chromiumPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      fileUrl,
    ],
    { stdio: 'pipe', timeout: 30000 }
  );
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const diagrams = [
    { name: '01_uml_use_case_diagram', build: buildUseCaseDiagram },
    { name: '02_uml_component_deployment_architecture', build: buildArchitectureDiagram },
    { name: '03_uml_class_domain_model', build: buildClassDiagram },
    { name: '04_uml_sequence_auth_and_tickets', build: buildSequenceAuthDiagram },
    { name: '05_uml_sequence_crdt_roles_snapshots', build: buildSequenceCrdtDiagram },
    { name: '06_uml_sequence_execution_and_voice', build: buildSequenceExecVoiceDiagram },
    { name: '07_scrumban_epics_stories_tasks_board', build: buildScrumbanBoard },
  ];

  const chromium = findChromium();
  console.log(`Generating ${diagrams.length} UML & Scrumban diagrams in ${path.relative(REPO_ROOT, OUT_DIR)}...`);

  for (const d of diagrams) {
    const svgContent = d.build();
    const svgPath = path.join(OUT_DIR, `${d.name}.svg`);
    const pngPath = path.join(OUT_DIR, `${d.name}.png`);
    fs.writeFileSync(svgPath, svgContent, 'utf8');

    if (chromium) {
      try {
        renderSvgToPng(chromium, svgPath, pngPath);
        const sz = fs.statSync(pngPath).size;
        console.log(`  OK  ${d.name}.svg + .png (${(sz / 1024).toFixed(1)} KB)`);
      } catch (err) {
        console.warn(`  WARN PNG render failed for ${d.name}: ${err.message}`);
      }
    } else {
      console.log(`  OK  ${d.name}.svg (no headless Chromium found for PNG conversion)`);
    }
  }
}

main();
