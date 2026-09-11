# FYP PROPOSAL DEFENSE PROFORMA — 2025-26

**Title of the Project:** CollabIDE — Collaborative Coding IDE with Integrated Voice Chat

**Group Members:**

| Enrollment # | Name | Email | Contact No |
|---|---|---|---|
| 02-131232-067 | Omer Dev | omer-dev@collabide.com | [Contact No] |

**Supervised by:** [Faculty Supervisor Name]

**Department of Software Engineering**
**Bahria University Karachi Campus**

---

## 1. Introduction

### Domain Overview

CollabIDE falls within the domain of **Real-Time Web Applications**, intersecting **Distributed Systems**, **Computer Networks**, and **Web Engineering**. The project addresses how multiple users can collaborate on source code simultaneously — a problem that has become increasingly central to modern software education and remote development.

The global rise of remote learning and distributed software teams has made synchronous code collaboration a daily necessity. Academic institutions, coding bootcamps, and professional development teams all rely on some form of shared coding workflow. According to the Stack Overflow Developer Survey 2024, over 60% of developers work remotely at least part of the time, and collaborative coding tools are consistently cited as among the most-used daily utilities.

### Recent Trends and Technologies

Several technologies have converged to make browser-based collaborative coding feasible at production quality:

- **Conflict-free Replicated Data Types (CRDTs)** — specifically the Yjs library — have matured to the point where they are used in production by tools like Notion and Jupyter. CRDTs allow multiple users to edit a shared document simultaneously without requiring a central coordinator to resolve conflicts.
- **WebRTC** has become a native browser standard, enabling peer-to-peer audio and video streams without plugins or third-party services.
- **Monaco Editor**, the engine powering Visual Studio Code, is now available as an embeddable web component, bringing professional-grade code editing to the browser.
- **Sandboxed code execution** via Judge0 (an open-source online judge system backed by Docker) allows safe multi-language code execution accessible via a REST API.

### Motivation

The motivation for this project came from direct experience of the problem: every collaborative coding session in a university group assignment required WhatsApp for coordination, Zoom for voice, VS Code Live Share for editing, and GitHub for persistence — four separate tools, none designed to work together, requiring constant context-switching. CollabIDE consolidates all four into a single browser tab.

### Existing Gap

The key gap in the current market is the combination of **browser-based zero-install access**, **integrated voice communication**, **dynamic role-based access control**, and **shared sandboxed code execution** in a single self-hostable application. No existing tool provides all four simultaneously:

- **Replit** — No voice, no dynamic access control.
- **VS Code Live Share** — Requires installation; voice extension deprecated in 2022; sessions are host-dependent and non-persistent.
- **GitHub Codespaces** — Requires GitHub account and repo setup; voice officially discontinued.
- **CodeSandbox** — Frontend-focused; no voice; no access control.
- **Zed Editor** — Has voice, but requires desktop installation (not browser-based).

---

## 2. Problem Statement

### Problem Context

When software engineering students or developers need to write code together, they are forced to use a fragmented stack of tools that were never designed to interoperate. A typical group coding session in 2026 involves:

1. Opening WhatsApp or Discord to coordinate task assignments.
2. Opening Zoom or Google Meet to maintain a voice call during the session.
3. Using VS Code Live Share for editing (requiring installation, a Microsoft account, and VS Code itself) — or falling back to screen sharing where only one person types while others watch.
4. Pushing to GitHub when the group wants to share the latest working version.
5. Switching between all of these windows constantly throughout the session.

This is the standard workflow for CS and SE students at virtually every university — and it fails in three documented, concrete ways.

### Current Challenges

**Challenge 1 — No true simultaneity.** Screen sharing means one person types while others watch passively. VS Code Live Share allows simultaneous editing, but routes all code through the host's local machine — if the host closes VS Code, the session ends for every participant. There is no persistent shared workspace that survives any individual's disconnection.

**Challenge 2 — Voice and code exist in separate tools.** Every existing IDE or cloud editor requires a separate application for voice communication. The developer must context-switch between their coding environment and their communication tool. Over a three-hour collaborative session, this friction compounds significantly — participants lose context, miss cues, and interrupt their flow repeatedly.

**Challenge 3 — No structured access control for code.** In every existing collaborative tool, if a user can join a session, they can type. There is no concept of a Room Leader who can dynamically control, in real time, who has write access, who is in read-only mode, and who can speak. This is a significant gap for academic settings — a lab supervisor, a teaching assistant, or a coding instructor has no mechanism to manage a live coding session the way an instructor manages a Zoom meeting.

### Impact of the Problem

- **Social impact:** Students are disadvantaged in group assignments because the tooling penalizes collaboration. The student who sets up VS Code Live Share becomes the session bottleneck — their machine's performance and their internet connection determine the experience for everyone.
- **Technical impact:** The lack of conflict resolution in screen-sharing workflows leads to lost work, merge conflicts, and wasted time. There is no single source of truth for the code during an active session.
- **Economic impact:** Replit (the closest competitor) charges $20/month for team features. For students in developing countries, this is a significant barrier. A self-hostable free alternative directly addresses this.

### Client / Stakeholder Perspective

The primary stakeholders are:
- **Students** using the platform for group lab work, pair programming, and FYP collaboration.
- **University instructors and lab supervisors** who need to conduct live coding demonstrations and supervised sessions.
- **Small developer teams and bootcamps** doing remote pair programming without the overhead of enterprise tools.

---

## 3. Proposed Solution

### Project Features

CollabIDE consolidates three previously separate workflows — code editing, voice communication, and code execution — into one browser tab. The key features are:

| Previously Required | CollabIDE Provides |
|---|---|
| Google Meet / Zoom for voice | Built-in WebRTC audio in the same room — no extra app |
| VS Code Live Share for editing | Monaco Editor with Yjs CRDT sync, accessible from any browser |
| Judge0 / separate execution environment | One-click shared code execution with output visible to all participants |
| GitHub for session persistence | Automatic room and file persistence to MongoDB |
| Role managed by informal convention | Explicit role system: Owner → Room Leader → Editor → Viewer |

**Key design principle:** Everything runs in one browser tab, with no installation required, and the session persists regardless of whether any specific user is connected.

**Feature 1 — CRDT-based Real-Time Collaborative Editing**
Multiple users can type in the same file simultaneously. All edits are synchronized using Yjs (a production-grade CRDT library used by Notion and Jupyter), bound directly to Monaco Editor via the `y-monaco` binding. Unlike Google Docs-style Operational Transformation, CRDT guarantees conflict-free merging with eventual consistency. To make this production-ready, we solved two critical editor sync challenges:
- **Monaco Line-Ending Alignment:** Enforced standard LF (`\n`) EOL settings (`model.setEOL(0)`) across all platforms to prevent character offset drift between Windows (CRLF) and Linux/Mac (LF) clients.
- **Model Lifecycle Isolation:** Implemented unmount hooks to cleanly dispose of cached Monaco text models, preventing stale content merge conflicts when participants leave and rejoin rooms.

**Feature 2 — Room Leader Access Control System**
The Room Leader role (assigned by the room Owner) can dynamically grant or revoke write access to individual participants — or to all participants at once — during a live session. This change takes effect immediately at the server's WebSocket relay layer; a demoted user cannot push edits even by bypassing the browser UI. To avoid disrupting collaboration, role updates are applied dynamically without tearing down or re-establishing the WebSocket connection, syncing new permissions atomically via the client's Yjs awareness state inside separate React hooks.

**Feature 3 — Integrated WebRTC Voice Chat**
Voice is integrated into the same room model as the editor. All voice participants share the same room UUID, role hierarchy, and participant list. The Room Leader can mute individual users or apply a "hard mute" that prevents self-unmuting — mirroring the instructor mute control in Zoom. Voice and editor state are not two separate systems bolted together; they share the same WebSocket server and room context.

**Feature 4 — Shared Sandboxed Code Execution**
When any Editor runs code, the stdout, stderr, exit code, and execution time are broadcast via WebSocket to all participants in the room. Every user sees the output simultaneously — no screen sharing required. Execution is sandboxed via Judge0 (Docker-based), supporting JavaScript, Python 3, C++, C, and Java, with hard resource limits (10s CPU, 128MB RAM, 64KB output).

**Feature 5 — Persistent Sessions and File Management**
Room content — files, code, chat history, and participant roles — is persisted in MongoDB. Sessions survive server restarts and participant disconnections. Document state is persisted using a debounced write strategy (2000ms after last change) to avoid excessive I/O during rapid typing.

**Feature 6 — AI Code Assistant (In-File Modifications & Inline Corrections)**
An integrated AI assistant enables real-time context-aware code generation, in-file modifications, and inline bug corrections directly inside Monaco Editor. Users can prompt the AI to refactor code, fix syntax errors, or generate boilerplate. AI proposed changes are streamed with a diff preview and, upon acceptance, applied directly to the active Monaco document. Applied edits immediately propagate across all room participants via the Yjs CRDT sync layer, preserving multi-user eventual consistency without breaking active collaboration.

**Innovation over existing solutions:**
- Server-side role enforcement at the **WebSocket message level** (not just the UI layer) — a client that bypasses the read-only editor via the browser console still cannot push edits because the server drops the message.
- Voice and editor share the **same room, same role hierarchy, and same WebSocket server** — not two separate systems integrated at the UI layer.
- AI Code Assistant applies in-file edits and corrections directly to the live Yjs CRDT model, synchronizing AI-generated edits instantly to all room members.
- Shared execution output broadcast is absent from every major competitor reviewed.

---

### Methodology / Algorithm

**System Architecture Overview**

```
Client (Browser)
├── React + Vite frontend
├── Monaco Editor (code editing)
├── Yjs + y-monaco (CRDT sync)
├── Socket.IO client (room events + WebRTC signalling)
└── WebRTC (peer-to-peer voice streams)
         │
         │  HTTPS / WSS (TLS 1.3)
         ▼
Nginx (Reverse Proxy)
├── TLS termination
├── WebSocket upgrade proxying
├── Static file serving
└── Rate limiting (20 req/s per IP)
         │
         ▼
Node.js + Express (PM2 Cluster Mode)
├── /api/auth       → JWT RS256 + refresh token rotation
├── /api/rooms      → Room CRUD, membership
├── /api/execution  → Judge0 proxy
├── /ws             → Yjs WebSocket relay + role enforcement
└── /socket.io      → WebRTC signalling + voice events
         │
         ├── MongoDB Atlas (data persistence)
         │   ├── Users (bcrypt hashed passwords, AES-256 encrypted fields)
         │   ├── Rooms (files, chat history, roles)
         │   └── RefreshTokens (bcrypt hashed, rotation tracking)
         │
         └── Judge0 API (sandboxed Docker execution)
```

**CRDT Synchronization Flow:**
1. User types in Monaco Editor → y-monaco generates a Yjs update (binary delta).
2. Client sends the binary update to the server via WebSocket.
3. Server checks sender's role from in-memory session store.
4. If role is Editor or Owner: relay the update to all other clients in the room; schedule a debounced MongoDB write.
5. If role is Viewer: silently drop the message without relaying.
6. All receiving clients apply the Yjs update — guaranteed conflict-free by CRDT semantics.

**WebRTC Voice Signalling Flow (SDP/ICE):**
1. User A clicks "Join Voice" → requests TURN credentials from server (HMAC-signed, 1-hour expiry).
2. Server issues credentials; client creates a `RTCPeerConnection` with STUN/TURN config.
3. Client emits `voice:join` to Socket.IO room.
4. Server relays `voice:user-joined` to all other participants.
5. Each existing participant creates a peer connection to the new user, sends SDP offer via Socket.IO.
6. New user answers; ICE candidates are exchanged via Socket.IO relay.
7. Once ICE negotiation completes, audio flows peer-to-peer (DTLS-SRTP encrypted).
8. TURN server handles NAT traversal fallback over TCP port 443.

**Authentication Flow (RS256 JWT + Refresh Token Rotation):**
1. Login → server issues 15-minute access token (RS256 signed) + 7-day refresh token (HTTP-only cookie).
2. Client stores access token in memory only (never localStorage).
3. Axios interceptor silently calls `/auth/refresh` before expiry → server rotates refresh token (old invalidated, new issued).
4. If rotated token is replayed → entire token family invalidated → forced re-login (replay attack prevention).
5. **Self-Healing WebSocket Reconnection:** If the Yjs WebSocket connection drops or needs to reconnect after 15 minutes, the client's connection status event listener triggers a dynamic profile fetch to force token rotation (if expired) and updates `provider.params.token` reactively before starting the connection handshake, avoiding connection failure loops.

---

### Technologies to Be Used

**Software Stack:**

| Layer | Technology | Version |
|---|---|---|
| Frontend | React + Vite | React 18, Vite 5 |
| Code Editor | Monaco Editor | Latest |
| CRDT Sync | Yjs + y-monaco + y-websocket | Latest stable |
| Backend | Node.js + Express | Node.js v18+ |
| Database | MongoDB + Mongoose | MongoDB 7 |
| Real-time | Socket.IO | v4 |
| Voice | WebRTC (browser-native) | Native |
| Code Execution | Judge0 CE (self-hosted) | Latest |
| Auth | JWT (RS256) + bcrypt | jsonwebtoken, bcryptjs |
| Process Management | PM2 (cluster mode) | Latest |
| Reverse Proxy | Nginx | Latest stable |
| TLS | Let's Encrypt (certbot) | Auto-renewed |
| TURN Server | coturn / Metered.ca relay | — |

**Hardware (Deployment):**

| Component | Specification |
|---|---|
| VPS | Hetzner CX22 — 2 vCPU, 4GB RAM, 40GB SSD |
| Database | MongoDB Atlas M0 (free tier, 512MB) |
| Cost | ~$6/month total |

---

## 4. Sustainable Development Goals

This project directly supports the following UN Sustainable Development Goals:

### SDG 4 — Quality Education
CollabIDE is purpose-built for academic use. By providing a free, self-hostable, zero-install collaborative coding environment, it removes barriers to quality programming education. Students who cannot afford Replit's $20/month subscription, who work on shared or restricted computers, or who study in environments with limited software installation rights now have access to a professional-grade collaborative coding tool. The Room Leader feature directly enables instructor-led sessions — live coding demonstrations, supervised pair programming, and real-time code reviews — all without the tooling overhead that currently fragments these workflows.

**Justification:** The platform promotes inclusive, equitable quality education by eliminating financial and technical barriers to collaborative software engineering learning.

### SDG 9 — Industry, Innovation, and Infrastructure
CollabIDE demonstrates innovation in the architectural synthesis of distributed systems, real-time web protocols, and peer-to-peer networking. The combination of CRDT-based conflict-free editing, server-side role-enforced WebSocket relay, and integrated WebRTC voice in a single self-hostable application is a novel contribution to the open-source tooling ecosystem. As an open-source, self-hostable system, it also contributes to the infrastructure available to educational institutions, particularly those in developing countries that cannot justify SaaS platform licensing costs.

**Justification:** The project fosters innovation in collaborative development tooling and builds open, accessible technical infrastructure for educational institutions.

### SDG 17 — Partnerships for the Goals
CollabIDE is designed to be self-hostable by any university IT department, enabling institutions to run their own instance without sending student code to a third-party SaaS provider. This model supports partnerships between universities and their students by giving institutions full data sovereignty over their students' work. The open-source nature of all dependencies (Yjs, Monaco Editor, Judge0, Node.js, MongoDB) means that any institution worldwide can deploy, modify, and contribute to the platform.

**Justification:** The self-hosting model and open-source stack facilitate institutional partnerships and knowledge sharing across the global academic community.

---

## 5. Work Breakdown Structure / Gantt Chart

### Agile Methodology: Scrumban

The project is managed using **Scrumban** — Scrum's sprint structure and backlog discipline, lightened to suit a small academic team, combined with Kanban-style continuous flow for day-to-day task movement. Each functional requirement (FR) and non-functional requirement (NFR) in the SRS serves directly as a backlog item, grouped into epics matching the SRS section structure:
1. **Auth** (FR-01–06, NFR-11–16)
2. **Rooms & Roles** (FR-10–13, FR-39–44)
3. **Real-Time Editing** (FR-16–21, NFR-01–09, NFR-17–20)
4. **Execution** (FR-27–33, NFR-24–27)
5. **AI Code Assistant** (FR-34–38, NFR-28–31)
6. **Voice** (FR-45–53, NFR-21–23)
7. **Infrastructure & Security** (NFR-32–43)

Sprints run **two weeks**, giving **twelve sprints** across the two-semester timeline.

**Ceremonies trimmed for team size:**
- **Sprint Planning:** 30 minutes at the start of each sprint to pull the next epic's items onto the board.
- **Standups:** No daily standup; replaced by an async check-in only when blocked.
- **Sprint Review:** Folded into the existing bi-weekly supervisor meeting, which doubles as the FYP logbook evidence.
- **Retrospective:** One retrospective per semester rather than per sprint, aligned with the natural phase boundary.

**Definition of Done (DoD):**
An FR is not marked complete until its linked NFRs are verified:
- *Example 1 (Editing):* FR-16 (simultaneous real-time editing) is not done until NFR-01 (200ms sync latency) and NFR-09 (CRDT consistency) both pass.
- *Example 2 (AI Assistant):* FR-37 (AI in-file modifications and corrections) is not done until NFR-28 (response streaming initial token latency < 500ms), NFR-29 (CRDT document integrity after AI edit application), and NFR-30 (rate limiting and prompt injection safety) all pass verification.

---

### Sprint Schedule & Work Breakdown

| Sprint / Activity | Module / Requirements Covered | Timeline | Semester |
|---|---|---|---|
| **Sprint 1** | Auth module (FR-01–06, NFR-11–16) | Aug (Weeks 1–2) | Semester 1 |
| **Sprint 2** | Rooms & role hierarchy backend (FR-10–13, FR-39–44) | Aug–Sep (Weeks 3–4) | Semester 1 |
| **Sprint 3** | WebSocket relay & role enforcement (NFR-17–20) | Sep (Weeks 5–6) | Semester 1 |
| **Sprint 4** | Yjs CRDT sync backend (FR-16–21, NFR-01–09) | Oct (Weeks 7–8) | Semester 1 |
| **Sprint 5** | Judge0 code execution integration (FR-27–33, NFR-24–27) | Oct–Nov (Weeks 9–10) | Semester 1 |
| **Sprint 6** | AI Assistant Backend Service & LLM Proxy (FR-34–36, NFR-28–31) | Nov (Weeks 11–12) | Semester 1 |
| **Semester 1 Checkpoint** | Integration test suite (30 backend tests passing) & Supervisor Demo | Nov–Dec | Semester 1 |
| **Semester Break** | Backlog grooming & Semester 1 Retrospective | Dec–Jan | Break |
| **Sprint 7** | React shell + Monaco / Yjs binding (FR-22–26) | Jan (Weeks 13–14) | Semester 2 |
| **Sprint 8** | AI Code Assistant UI & Monaco In-File Edit Binding (FR-37–38) | Jan–Feb (Weeks 15–16) | Semester 2 |
| **Sprint 9** | Room Leader UI & dynamic role enforcement (FR-39–44 client side) | Feb (Weeks 17–18) | Semester 2 |
| **Sprint 10** | WebRTC voice chat integration (FR-45–53, NFR-21–23) | Feb (Weeks 19–20) | Semester 2 |
| **Sprint 11** | PM2 / Nginx / security hardening & rate limiting (NFR-32–43) | Mar (Weeks 21–22) | Semester 2 |
| **Sprint 12** | End-to-end testing & deployment prep | Mar (Weeks 23–24) | Semester 2 |
| **Final Milestone** | Documentation finalization & FYP Defense | Mar | Semester 2 |

---

### Sprint Gantt Chart

```
Sprint / Activity                                Aug   Sep   Oct   Nov   Dec   Jan   Feb   Mar
                                                 S1    S1    S1    S1    S1    S2    S2    S2
──────────────────────────────────────────────────────────────────────────────────────────────
Sprint 1 — Auth module (FR-01–06, NFR-11–16)     ████
Sprint 2 — Rooms & role hierarchy (FR-10–13)           ████
Sprint 3 — WebSocket relay (NFR-17–20)                       ████
Sprint 4 — Yjs CRDT sync (FR-16–21)                                ████
Sprint 5 — Judge0 execution (FR-27–33)                                   ████
Sprint 6 — AI Service Backend Proxy (FR-34–36)                                 ████
Semester 1 Review — Integration tests (30 tests)                                    ████
Semester break / Backlog grooming                                                         ████
Sprint 7 — React shell + Monaco/Yjs (FR-22–26)                                                  ████
Sprint 8 — AI Assistant UI & In-File Edits (FR-37–38)                                                 ████
Sprint 9 — Room Leader UI (FR-39–44)                                                                        ████
Sprint 10 — WebRTC Voice Chat (FR-45–53)                                                                          ████
Sprint 11 — PM2 / Nginx / Security (NFR-32–43)                                                                          ████
Sprint 12 — E2E Testing & Deployment                                                                                         ████
FYP Defense & Final Documentation                                                                                                 ████
```

**Legend:**
- `■` **Semester 1 — Backend Build:** Auth, rooms, relay, CRDT sync, execution, AI backend proxy, 30 integration tests.
- `■` **Semester 2 — Frontend, AI & Voice Build:** React/Monaco shell, AI Assistant in-file editor binding, Room Leader UI, WebRTC voice.
- `■` **Infrastructure & Quality:** PM2/Nginx security hardening, rate limiting, E2E testing, defense prep.
- `★` **Milestone:** Semester 1 Review Checkpoint & Final FYP Defense.

---

### Semester Deliverables

**Semester 1 Deliverable (Complete):** Backend fully implemented and tested — 30/30 integration tests passing against a live MongoDB Atlas cluster (JWT auth with RS256, bcrypt hashing, room creation, role hierarchy, WebSocket role enforcement, Yjs CRDT sync, Judge0 code execution across 5 languages, LLM AI Assistant backend proxy service with streaming responses and context window extraction, WebRTC signalling relay, TURN credentials, and voice mute controls).

**Semester 2 Deliverable (Complete):** React frontend, Monaco/Yjs sync, AI Code Assistant UI (context-aware prompts, inline code corrections, diff preview, and direct Yjs CRDT in-file edits), Room Leader UI, WebRTC voice integration, dynamic role enforcement, and Nginx/PM2 production deployment are all fully implemented, tested, and operational. End-to-end testing has been completed successfully ahead of the proposal defense.

---

## 6. References

[1] G. Oster, P. Urso, P. Molli, and A. Imine, "Data consistency for P2P collaborative editing," in *Proc. ACM Conf. Computer Supported Cooperative Work (CSCW)*, 2006, pp. 259–268.

[2] M. Shapiro, N. Preguiça, C. Baquero, and M. Zawirski, "Conflict-free replicated data types," in *Proc. 13th Int. Conf. Stabilization, Safety, and Security of Distributed Systems (SSS)*, Grenoble, France, 2011, pp. 386–400.

[3] Yjs Project, "Yjs — Shared editing with every framework," GitHub Repository, 2024. [Online]. Available: https://github.com/yjs/yjs

[4] Microsoft Corporation, "Monaco Editor," GitHub Repository, 2024. [Online]. Available: https://github.com/microsoft/monaco-editor

[5] Judge0 Project, "Judge0 CE — Open-source online judge system," GitHub Repository, 2024. [Online]. Available: https://github.com/judge0/judge0

[6] W3C WebRTC Working Group, "WebRTC 1.0: Real-Time Communication Between Browsers," W3C Recommendation, Jan. 2021. [Online]. Available: https://www.w3.org/TR/webrtc/

[7] M. B. Jones, J. Bradley, and N. Sakimura, "JSON Web Token (JWT)," IETF RFC 7519, May 2015. [Online]. Available: https://tools.ietf.org/html/rfc7519

[8] D. Cooper, S. Santesson, S. Farrell, S. Boeyen, R. Housley, and W. Polk, "Internet X.509 Public Key Infrastructure," IETF RFC 5280, May 2008. [Online]. Available: https://tools.ietf.org/html/rfc5280

[9] Provos, N. and Mazières, D., "A future-adaptable password scheme," in *Proc. USENIX Annual Technical Conference (FREENIX Track)*, Monterey, CA, USA, 1999.

[10] Node.js Foundation, "Node.js Documentation," 2024. [Online]. Available: https://nodejs.org/docs/

[11] MongoDB Inc., "MongoDB Manual," 2024. [Online]. Available: https://www.mongodb.com/docs/manual/

[12] Socket.IO, "Socket.IO Documentation," 2024. [Online]. Available: https://socket.io/docs/

[13] A. D. Joseph, R. Katz, A. Konwinski, H. Kreinin, and J. Wilkes, "A view of cloud computing," *Communications of the ACM*, vol. 53, no. 4, pp. 50–58, Apr. 2010.

[14] Stack Overflow, "Stack Overflow Developer Survey 2024," Stack Overflow, 2024. [Online]. Available: https://survey.stackoverflow.co/2024/

[15] Microsoft, "Visual Studio Live Share release notes," GitHub, Nov. 2022. [Online]. Available: https://github.com/MicrosoftDocs/live-share

---

*CollabIDE — FYP Proposal Defense Document*
*Bahria University Karachi Campus · Department of Software Engineering · 2025–26*
