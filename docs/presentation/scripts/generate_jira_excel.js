#!/usr/bin/env node
/**
 * @file generate_jira_excel.js
 * @description Generates a multi-sheet Excel workbook (.xlsx) and enriched Jira CSV
 * for CollabIDE's Scrumban breakdown (Epics, User Stories, and Tasks), combining:
 *   1. docs/04_status/jira_scrumban_import.csv (Phase 1 SRS v1.2 backlog)
 *   2. Phase 2 Exhaustive System Design Requirements (SRS v2.0)
 *   3. Real implementation status and team ownership tracked from Git history
 *
 * Uses pure OOXML SpreadsheetML + frontend/node_modules/jszip (zero extra dependencies).
 *
 * Usage:
 *   node docs/presentation/scripts/generate_jira_excel.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const JSZip = require(path.join(REPO_ROOT, 'frontend/node_modules/jszip'));
const JIRA_CSV_PATH = path.join(REPO_ROOT, 'docs/04_status/jira_scrumban_import.csv');
const OUT_XLSX = path.join(REPO_ROOT, 'docs/presentation/CollabIDE_Scrumban_Jira.xlsx');
const OUT_CSV = path.join(REPO_ROOT, 'docs/presentation/CollabIDE_Jira_Scrumban_Full.csv');

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
        i++;
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

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function xmlEsc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(idx) {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Accurate git-tracked status and team attribution for every requirement ID
function resolvePhase1Meta(reqId, epic) {
  // Unmerged remote PR branches (In Review)
  if (['FR-37', 'FR-38', 'NFR-28'].includes(reqId)) {
    return { status: 'In Review (PR)', branch: 'feat/fr37-fr38-workspace-snapshots-and-security', owner: 'Omer Siddiqui' };
  }
  if (reqId === 'FR-09') {
    return { status: 'In Review (PR)', branch: 'feat/FR-09-password-reset (Maaz) + feat/FR-09-password-reset-suite (Hamza)', owner: 'Maaz Ahmed & Hamza Tanveer' };
  }
  // Maaz Ahmed contributions
  if (['FR-08', 'FR-26', 'NFR-14', 'NFR-15', 'NFR-32', 'NFR-33', 'NFR-34', 'NFR-36', 'NFR-38', 'NFR-40', 'NFR-41', 'NFR-49', 'NFR-55'].includes(reqId)) {
    return { status: 'Done (main)', branch: 'main', owner: 'Maaz Ahmed' };
  }
  // Hamza Tanveer contributions
  if (['FR-14', 'FR-23', 'FR-24', 'FR-25', 'NFR-13', 'NFR-16', 'NFR-22', 'NFR-23', 'NFR-39', 'NFR-42', 'NFR-44', 'NFR-45', 'NFR-46', 'NFR-47', 'NFR-48', 'NFR-50', 'NFR-51', 'NFR-52', 'NFR-53', 'NFR-54'].includes(reqId)) {
    return { status: 'Done (main)', branch: 'main', owner: 'Hamza Tanveer' };
  }
  // Omer Siddiqui contributions (Core IDE, Yjs, Roles, Voice, Execution, NFR-01-12, NFR-17-21, NFR-24-27, NFR-35, NFR-37, NFR-43)
  return { status: 'Done (main)', branch: 'main', owner: 'Omer Siddiqui' };
}

function buildDefaultTasks(reqId, summary) {
  const cleanTitle = summary.replace(/^[A-Z]+-\d+:\s*/, '');
  return `1. Backend/API & Schema (${reqId}) | 2. Frontend UI / Integration (${cleanTitle}) | 3. Automated Verification Test`;
}

function buildSheetXml(rows, colWidths) {
  let colsXml = '<cols>';
  colWidths.forEach((w, i) => {
    colsXml += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
  });
  colsXml += '</cols>';

  let sheetData = '<sheetData>';
  rows.forEach((r, rIdx) => {
    const rowNum = rIdx + 1;
    const isHeader = rIdx === 0;
    const ht = isHeader ? 26 : 22;
    sheetData += `<row r="${rowNum}" ht="${ht}" customHeight="1">`;
    r.forEach((val, cIdx) => {
      const ref = `${colLetter(cIdx)}${rowNum}`;
      const styleIdx = isHeader ? 1 : (rIdx % 2 === 0 ? 3 : 2);
      if (typeof val === 'number' && Number.isFinite(val)) {
        sheetData += `<c r="${ref}" s="${styleIdx}"><v>${val}</v></c>`;
      } else {
        sheetData += `<c r="${ref}" t="inlineStr" s="${styleIdx}"><is><t>${xmlEsc(val)}</t></is></c>`;
      }
    });
    sheetData += '</row>';
  });
  sheetData += '</sheetData>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  ${colsXml}
  ${sheetData}
</worksheet>`;
}

const PHASE2_STORIES = [
  ['SDR-01', 'Distributed Scale (100k)', 'Control Plane vs. Data Plane Split & RS256 Ticket Auth', 'Highest', 'In Review (PR: Shared-Nothing Foundation) + Phase 2 Ticket Endpoint', 'Hamza Tanveer', '1. RSA-2048 key split & kid rotation | 2. POST /api/workspaces/:id/ticket (60s exp) | 3. Zero-DB WS handshake middleware | 4. 10k reconnect burst verification'],
  ['SDR-02', 'Distributed Scale (100k)', 'Envoy Fleet Ring-Hashing & Off-Hot-Path Redis Sharding', 'Highest', 'Backlog (Phase 2)', 'Team', '1. Configure envoy.yaml RING_HASH on ?roomId= | 2. Active /healthz 3s probes | 3. 60s idle WSSharedDoc eviction | 4. Segregate Redis to presence/migration only'],
  ['SDR-03', 'Distributed Scale (100k)', 'Dual-Profile Deployment Engine (Hetzner vs. AWS EKS)', 'Highest', 'Backlog (Phase 2)', 'Maaz Ahmed', '1. Parameterize DEPLOYMENT_PROFILE/STORAGE_ENGINE | 2. deploy/docker-compose.demo.yml (<3.5GB RAM) | 3. EKS Helm charts + HPA on websocket_active_connections'],
  ['SDR-04', 'Distributed Scale (100k)', 'NLB L4 Ingress & Envoy Connection Rate Limiting', 'High', 'Backlog (Phase 2)', 'Maaz Ahmed', '1. AWS NLB L4 TCP pass-through | 2. Envoy TLS 1.3 offloading | 3. Token-bucket 1000 conn/s per Envoy pod | 4. 300s idle timeout + 30s TCP keepalive'],
  ['SDR-05', 'Cloud IDE & Sandbox', 'Off-Hot-Path Containerized Workspace & Sandboxed Runner', 'Highest', 'Backlog (Phase 2)', 'Omer Siddiqui', '1. BullMQ code-execution-jobs queue | 2. Docker runner worker with cgroups (1 vCPU, 512MB, 128 PIDs, block 169.254.169.254) | 3. Stream execution:output:{jobId}'],
  ['FR-58', 'Cloud IDE & Sandbox', 'GitHub OAuth & Repository Cloning Pipeline', 'High', 'Backlog (Phase 2)', 'Omer Siddiqui', '1. GitHub OAuth 2.0 (read:user, repo) with AES-256-GCM token storage | 2. Paginated Repo Explorer modal | 3. Streaming git clone --depth 1 progress'],
  ['FR-59', 'Cloud IDE & Sandbox', 'Persistent Interactive Web Terminal (xterm.js + PTY)', 'Highest', 'Backlog (Phase 2)', 'Omer Siddiqui', '1. node-pty /bin/bash spawn (TERM=xterm-256color) | 2. Bi-directional WS + pty.resize() | 3. 50KB circular reconnect replay buffer'],
  ['FR-60', 'Code Intelligence & Git', 'Language Server Protocol (LSP) & Code Intelligence', 'High', 'Backlog (Phase 2)', 'Hamza Tanveer', '1. Decoupled TS & Pyright LSP worker container | 2. Monaco JSON-RPC 2.0 WS bridge | 3. Completion, hover (<100ms), definition, diagnostics (<250ms)'],
  ['FR-61', 'Code Intelligence & Git', 'Visual Source Control (Git UI & Diff Viewer)', 'Medium', 'Backlog (Phase 2)', 'Omer Siddiqui', '1. Background git status --porcelain watcher (<500ms) | 2. Monaco createDiffEditor side-by-side viewer | 3. Stage & commit UI actions'],
  ['FR-62', 'Code Intelligence & Git', 'Live Port Forwarding & Web Application Preview', 'Medium', 'Backlog (Phase 2)', 'Maaz Ahmed', '1. Inspect /proc/net/tcp for listening container ports | 2. Proxy https://{port}-{roomId}.preview.collabide.dev | 3. Embedded preview iframe with HMR'],
  ['NFR-56', 'C100K & Observability', 'Virtualized & Lazy-Loaded Monorepo File Tree', 'High', 'Backlog (Phase 2)', 'Omer Siddiqui', '1. Shallow GET /api/fs/tree?path= API | 2. react-window / @tanstack/react-virtual UI | 3. Enforce <=100 DOM nodes & <40MB RAM for 50k files'],
  ['NFR-58', 'C100K & Observability', 'Native Binary Yjs Protocol & Priority Backpressure', 'Highest', 'Backlog (Phase 2)', 'Hamza Tanveer', '1. Pure Uint8Array opcode 0x2 frames | 2. Disable perMessageDeflate at 100k scale (~80% CPU saved) | 3. 10-15Hz cursor throttle + drop when bufferedAmount > 64KB'],
  ['NFR-59', 'C100K & Observability', 'Two-Tier Sync State & Debounced Snapshot Flusher', 'Highest', 'Backlog (Phase 2)', 'Hamza Tanveer', '1. Hot WSSharedDoc + append-only updatesBuffer | 2. 10s BulkWrite flusher | 3. Compaction every 50 updates / 5m | 4. 15s preStop SIGTERM flush'],
  ['NFR-60', 'C100K & Observability', 'Linux Kernel C100K Parameter Tuning & Pod Quotas', 'Highest', 'Backlog (Phase 2)', 'Maaz Ahmed', '1. nofile=1048576 & file-max=2097152 | 2. somaxconn/backlog=65535 | 3. tcp_rmem/wmem & tcp_tw_reuse | 4. Pod 512Mi-1Gi (~2,500 conns/pod x 40 pods)'],
  ['NFR-61', 'C100K & Observability', 'Reconnect Storm Resiliency & State-Vector Resync', 'Highest', 'Backlog (Phase 2)', 'Hamza Tanveer', '1. Decorrelated Jitter backoff (1s-30s) | 2. SyncStep1 state-vector diff (<2KB payload) | 3. system:pod_draining 10s staged migration'],
  ['NFR-62', 'C100K & Observability', 'Distributed 100k Load Generator & Observability Pipeline', 'Highest', 'Backlog (Phase 2)', 'Maaz Ahmed', '1. 10x distributed k6 runners (10k VUs each) | 2. prom-client /metrics gauges & latency histograms | 3. Grafana 100k plateau dashboard (<$5 Spot run)'],
];

async function main() {
  const csvRaw = fs.readFileSync(JIRA_CSV_PATH, 'utf8');
  const parsed = parseCsv(csvRaw);
  const rows = parsed.slice(1).filter((r) => r.length >= 2 && r[0]);

  const phase1Stories = rows.filter((r) => r[0].trim() === 'Story').map((r) => {
    const summary = (r[1] || '').trim();
    const reqMatch = summary.match(/^([A-Z]+-\d+)/);
    const reqId = reqMatch ? reqMatch[1] : 'TASK';
    const rawDesc = (r[2] || '').split('\n---\n')[0].replace(/\s+/g, ' ').trim();
    const prioMatch = rawDesc.match(/Priority:\s*(High|Medium|Low)/i);
    const priority = prioMatch ? prioMatch[1] : 'High';
    const targetMatch = rawDesc.match(/Target:\s*(Semester\s*\d)/i);
    const target = targetMatch ? targetMatch[1] : 'Semester 2';
    const epic = (r[4] || 'Infrastructure & Security').trim();
    const meta = resolvePhase1Meta(reqId, epic);
    const tasks = buildDefaultTasks(reqId, summary);
    return {
      reqId,
      epic,
      summary,
      priority,
      target,
      status: meta.status,
      branch: meta.branch,
      owner: meta.owner,
      tasks,
      description: rawDesc.slice(0, 320),
    };
  });

  // Sheet 1: Epics Summary
  const epicGroups = new Map();
  for (const s of phase1Stories) {
    if (!epicGroups.has(s.epic)) {
      epicGroups.set(s.epic, { phase: 'Phase 1 (SRS v1.2)', total: 0, done: 0, review: 0, backlog: 0, owners: new Set() });
    }
    const g = epicGroups.get(s.epic);
    g.total++;
    if (s.status.startsWith('Done')) g.done++;
    else if (s.status.startsWith('In Review')) g.review++;
    else g.backlog++;
    g.owners.add(s.owner);
  }
  for (const p2 of PHASE2_STORIES) {
    const ep = p2[1];
    if (!epicGroups.has(ep)) {
      epicGroups.set(ep, { phase: 'Phase 2 (SRS v2.0)', total: 0, done: 0, review: 0, backlog: 0, owners: new Set() });
    }
    const g = epicGroups.get(ep);
    g.total++;
    if (p2[4].startsWith('In Review')) g.review++;
    else g.backlog++;
    g.owners.add(p2[5]);
  }

  const sheet1Rows = [
    ['Epic Name', 'Phase', 'Total Stories', 'Done (main)', 'In Review (PR)', 'Backlog', 'Completion %', 'Contributors'],
  ];
  for (const [name, g] of epicGroups.entries()) {
    const pct = g.total ? Math.round(((g.done + g.review) / g.total) * 100) + '%' : '0%';
    sheet1Rows.push([name, g.phase, g.total, g.done, g.review, g.backlog, pct, Array.from(g.owners).join(', ')]);
  }

  // Sheet 2: Phase 1 User Stories & Tasks
  const sheet2Rows = [
    ['Req ID', 'Epic Link', 'User Story Summary', 'Priority', 'Target', 'Scrumban Status', 'Git Branch', 'Lead Contributor', 'Decomposed Scrumban Tasks', 'Acceptance / Description'],
    ...phase1Stories.map((s) => [s.reqId, s.epic, s.summary, s.priority, s.target, s.status, s.branch, s.owner, s.tasks, s.description]),
  ];

  // Sheet 3: Phase 2 User Stories & Tasks (SRS v2.0)
  const sheet3Rows = [
    ['Req ID', 'Epic Link', 'User Story / System Requirement', 'Priority', 'Scrumban Status', 'Lead Owner', 'Decomposed Implementation Tasks'],
    ...PHASE2_STORIES,
  ];

  // Sheet 4: Combined Jira CSV Import Ready
  const jiraImportRows = [
    ['Issue Type', 'Summary', 'Description', 'Epic Name', 'Epic Link', 'Priority', 'Status', 'Assignee'],
  ];
  for (const [name, g] of epicGroups.entries()) {
    jiraImportRows.push(['Epic', name, `${g.phase} Epic covering ${g.total} stories`, name, '', 'High', g.backlog === g.total ? 'Backlog' : 'In Progress', '']);
  }
  for (const s of phase1Stories) {
    jiraImportRows.push(['Story', s.summary, `${s.description} | Tasks: ${s.tasks}`, '', s.epic, s.priority, s.status, s.owner]);
  }
  for (const p2 of PHASE2_STORIES) {
    jiraImportRows.push(['Story', `${p2[0]}: ${p2[2]}`, `Phase 2 SRS v2.0 | Tasks: ${p2[6]}`, '', p2[1], p2[3], p2[4], p2[5]]);
  }

  // Write clean CSV
  const csvOut = jiraImportRows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(OUT_CSV, csvOut, 'utf8');

  // Build valid OOXML .xlsx workbook
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Epics Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Phase 1 Stories &amp; Tasks" sheetId="2" r:id="rId2"/>
    <sheet name="Phase 2 SRS v2.0 Stories" sheetId="3" r:id="rId3"/>
    <sheet name="Jira Import Ready" sheetId="4" r:id="rId4"/>
  </sheets>
</workbook>`);

  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  // Clean, plain, legible Excel styles (Bahria Navy header, subtle alternating row tint)
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF1E293B"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF404096"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`);

  zip.file('xl/worksheets/sheet1.xml', buildSheetXml(sheet1Rows, [28, 22, 14, 14, 15, 12, 14, 34]));
  zip.file('xl/worksheets/sheet2.xml', buildSheetXml(sheet2Rows, [12, 24, 38, 12, 14, 18, 36, 18, 52, 60]));
  zip.file('xl/worksheets/sheet3.xml', buildSheetXml(sheet3Rows, [12, 26, 44, 12, 26, 18, 64]));
  zip.file('xl/worksheets/sheet4.xml', buildSheetXml(jiraImportRows, [12, 42, 62, 26, 26, 12, 20, 18]));

  const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(OUT_XLSX, outBuf);

  console.log('=== Scrumban Jira Excel & CSV Generation Complete ===');
  console.log(`Phase 1 Stories: ${phase1Stories.length} (from jira_scrumban_import.csv)`);
  console.log(`Phase 2 Stories: ${PHASE2_STORIES.length} (from SRS v2.0)`);
  console.log(`Total Epics:     ${epicGroups.size}`);
  console.log(`Excel Output:    ${path.relative(REPO_ROOT, OUT_XLSX).replace(/\\/g, '/')} (${(outBuf.length / 1024).toFixed(1)} KB)`);
  console.log(`CSV Output:      ${path.relative(REPO_ROOT, OUT_CSV).replace(/\\/g, '/')}`);
}

main().catch((err) => {
  console.error('Excel generation failed:', err);
  process.exit(1);
});
