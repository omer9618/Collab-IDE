# FYP PROPOSAL DEFENSE PROFORMA — 2025-26

**Title of the Project:** CollabIDE — Collaborative Coding IDE with Integrated Voice Chat

**Group Members:**

| Enrollment # | Name | Email | Contact No |
|---|---|---|---|
| 02-131232-067 | Omer | [email] | [contact] |

**Supervised by:** [Faculty Member Name]

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
Multiple users can type in the same file simultaneously. All edits are synchronized using Yjs (a production-grade CRDT library used by Notion and Jupyter), bound directly to Monaco Editor via the `y-monaco` binding. Unlike Google Docs-style Operational Transformation, CRDT guarantees conflict-free merging with eventual consistency regardless of message delivery order and without a central coordinator.

**Feature 2 — Room Leader Access Control System**
The Room Leader role (assigned by the room Owner) can dynamically grant or revoke write access to individual participants — or to all participants at once — during a live session. This change takes effect immediately at the server's WebSocket relay layer; a demoted user cannot push edits even by bypassing the browser UI. This is the feature that makes CollabIDE specifically useful for instructor-led sessions.

**Feature 3 — Integrated WebRTC Voice Chat**
Voice is integrated into the same room model as the editor. All voice participants share the same room UUID, role hierarchy, and participant list. The Room Leader can mute individual users or apply a "hard mute" that prevents self-unmuting — mirroring the instructor mute control in Zoom. Voice and editor state are not two separate systems bolted together; they share the same WebSocket server and room context.

**Feature 4 — Shared Sandboxed Code Execution**
When any Editor runs code, the stdout, stderr, exit code, and execution time are broadcast via WebSocket to all participants in the room. Every user sees the output simultaneously — no screen sharing required. Execution is sandboxed via Judge0 (Docker-based), supporting JavaScript, Python 3, C++, C, and Java, with hard resource limits (10s CPU, 128MB RAM, 64KB output).

**Feature 5 — Persistent Sessions and File Management**
Room content — files, code, chat history, and participant roles — is persisted in MongoDB. Sessions survive server restarts and participant disconnections. Document state is persisted using a debounced write strategy (2000ms after last change) to avoid excessive I/O during rapid typing.

**Innovation over existing solutions:**
- Server-side role enforcement at the **WebSocket message level** (not just the UI layer) — a client that bypasses the read-only editor via the browser console still cannot push edits because the server drops the message.
- Voice and editor share the **same room, same role hierarchy, and same WebSocket server** — not two separate systems integrated at the UI layer.
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

### Project Phases

| Phase | Activities |
|---|---|
| **Phase 1 — Requirements** | Problem analysis, SRS v1.0, competitor analysis, technology selection |
| **Phase 2 — Design** | System architecture, DB schema design, API specification, UI/UX specification |
| **Phase 3 — Implementation (Semester 1)** | Backend: Auth module, Room module, WebSocket relay, Judge0 integration, CRDT sync, 25 integration tests |
| **Phase 4 — Implementation (Semester 2)** | Frontend: React app, Monaco/Yjs integration, Voice chat (WebRTC), Room Leader UI, Dashboard |
| **Phase 5 — Testing** | Integration testing (live MongoDB Atlas), end-to-end testing, security testing, performance testing |
| **Phase 6 — Deployment** | VPS setup, Nginx config, PM2 cluster, HTTPS, TURN server, live demo deployment |
| **Phase 7 — Documentation** | SRS v1.2, UI/UX spec, architecture diagram, test logs, this proposal document |

### Gantt Chart

```
Task                              Aug   Sep   Oct   Nov   Dec   Jan   Feb   Mar
                                  S1    S1    S1    S1    S1    S2    S2    S2
─────────────────────────────────────────────────────────────────────────────
Requirements & SRS                ████
System Architecture Design              ████
Backend: Auth Module                    ████
Backend: Room + WebSocket Relay               ████
Backend: CRDT Sync (Yjs)                      ████
Backend: Judge0 Integration                         ████
Integration Testing (25 tests)                      ████
UI/UX Specification                                       ████
Frontend: Auth + Dashboard                                ████
Frontend: Monaco + Yjs binding                                  ████
Frontend: Voice Chat (WebRTC)                                   ████
Frontend: Room Leader UI                                              ████
End-to-End Testing                                                    ████
VPS Deployment (Nginx + PM2)                                          ████
Documentation Finalization                                                  ████
FYP Defense                                                                 ████
```

**Semester 1 Deliverable (Complete):** Backend fully implemented and tested — 25/25 integration tests passing against live MongoDB Atlas cluster. Modules verified: JWT auth with RS256, bcrypt hashing, room creation, role hierarchy, WebSocket role enforcement, Yjs CRDT sync, Judge0 execution (5 languages), WebRTC signalling, TURN credentials, voice mute controls.

**Semester 2 Deliverable (In Progress):** React frontend, Nginx + PM2 production deployment, end-to-end frontend-backend integration.

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
