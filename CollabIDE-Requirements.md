# CollabIDE — Software Requirements Specification
**Project:** Collaborative Coding IDE
**Degree:** Bachelor of Software Engineering (BSE)
**Institution:** Bahria University Karachi Campus
**Department:** Software Engineering
**Document Type:** Software Requirements Specification (SRS)
**Version:** 1.2
**Last Updated:** July 2026

---

### Revision History

| Version | Date | Summary of Changes |
|---|---|---|
| 1.0 | June 2026 | Initial release |
| 1.1 | July 2026 | Added C to FR-19; HTML/CSS live preview FR-38; SC-02 React clarification; NFR-25 WebSocket role enforcement; NFR-26 debounced persistence |
| 1.2 | July 2026 | Full rewrite of auth (FR-01–05) with robust token model; added Room Leader role and live access control (FR-08, FR-39–44); added Voice Chat module (FR-45–53); added server infrastructure, load balancing, and resource management NFRs (NFR-27–43); added data leakage prevention NFRs (NFR-44–50); updated dependencies table; UI scope note added to Section 1.3 |

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Stakeholders](#2-stakeholders)
3. [Business Requirements](#3-business-requirements)
4. [Functional Requirements](#4-functional-requirements)
   - 4.1 User Authentication and Account Management
   - 4.2 Room and Session Management
   - 4.3 Room Leader and Live Access Control
   - 4.4 Real-Time Collaborative Editing
   - 4.5 Code Editor
   - 4.6 Code Execution
   - 4.7 In-Room Chat
   - 4.8 Voice Chat
   - 4.9 Version History
   - 4.10 File Management
5. [Non-Functional Requirements](#5-non-functional-requirements)
   - 5.1 Performance
   - 5.2 Reliability
   - 5.3 Security — Authentication and Session
   - 5.4 Security — WebSocket and Real-Time Layer
   - 5.5 Security — Data Leakage Prevention
   - 5.6 Security — Voice Chat
   - 5.7 Server Infrastructure and Load Management
   - 5.8 Usability
   - 5.9 Maintainability
   - 5.10 Scalability
   - 5.11 Compatibility
6. [System Constraints](#6-system-constraints)
7. [Assumptions and Dependencies](#7-assumptions-and-dependencies)

---

## 1. Project Overview

### 1.1 Purpose
CollabIDE is a browser-based collaborative coding environment that enables multiple users to write, edit, and execute code simultaneously in real time. It also provides integrated voice communication within coding rooms, live editor access control managed by a designated Room Leader, and sandboxed multi-language code execution — all without requiring any software installation on the client side.

### 1.2 Problem Statement
Current code collaboration in academic and team environments relies on screen sharing, turn-based editing, or version control systems — none of which support true simultaneous multi-user editing with instant synchronization. Separate tools like Zoom or Google Meet handle voice but have no code awareness. CollabIDE unifies real-time collaborative editing, voice communication, and code execution in a single browser-based platform purpose-built for programming sessions.

### 1.3 Scope

**In scope:**
- Browser-based IDE with CRDT-based real-time sync (Yjs)
- Room Leader role with live editor access grant/revoke controls
- Multi-language code execution via Judge0 sandboxed containers
- WebRTC-based in-room voice chat with mute/unmute and access control
- Room-based session management with persistent file storage
- In-room text chat with history
- File tree with multi-file support per room
- Robust JWT + refresh token authentication with session management
- Server-side security, load management, and resource controls

**Out of scope:**
- Mobile native applications (iOS/Android)
- Video chat (audio only, inspired by Google Meet and Zoom)
- Screen sharing
- Recording of voice sessions
- Offline-first / PWA functionality
- UI design decisions — the current proof-of-concept UI is a throwaway prototype. Final UI will be defined separately in a UI/UX specification document. This SRS describes only backend behaviour and system constraints; no UI implementation details are prescribed here.

---

## 2. Stakeholders

| Stakeholder | Role | Interest |
|---|---|---|
| Students | Primary users | Collaborate on coding assignments in real time with voice |
| Room Leader | Elevated user role | Controls who can edit; manages the session |
| University faculty | Secondary users | Observe sessions, review code, monitor rooms |
| Project supervisor | Evaluator | Assess technical depth and academic quality |
| FYP defense committee | Evaluator | Assess system completeness, security, and innovation |
| System administrator | Operator | Deploy, monitor, and maintain server infrastructure |

---

## 3. Business Requirements

### BR-01 — Address a Real Collaborative Gap
The system must provide functionality not covered by existing free tools. VS Code Live Share requires installation; Google Docs does not support code execution; Zoom has no code editor. CollabIDE must combine all three concerns — editing, execution, and voice — in a single zero-install browser application.

### BR-02 — Academic Utility
The system must directly support university use cases: pair programming, group lab sessions, coding interviews, and supervised coding exams. The Room Leader feature must make it suitable for instructor-led sessions where the instructor controls who can type.

### BR-03 — Demonstrate Advanced Technical Concepts
As an FYP, the system must showcase: CRDT-based distributed document synchronization, WebRTC peer-to-peer voice signalling, sandboxed code execution, JWT token rotation with refresh tokens, server-side load management, and role-enforced WebSocket relay. The implementation must be demonstrably beyond a standard CRUD application.

### BR-04 — Deliverable within a Two-Semester Timeline
A working MVP (auth, collaboration, execution) must be deliverable by end of Semester 1. Voice chat, Room Leader controls, infrastructure hardening, and documentation are completed in Semester 2.

### BR-05 — Open-Source and Self-Hostable
The system must rely solely on open-source components to avoid licensing costs and allow self-hosting for the defense. No paid APIs or SaaS dependencies are permitted in the core system.

### BR-06 — Support Multiple Programming Languages
The platform must support execution of code in at least five programming languages covering common academic use cases: algorithms (C, C++), scripting (Python, JavaScript), and enterprise patterns (Java).

### BR-07 — Accessible via Standard Browser
The system must function on any modern desktop browser without plugins, extensions, or installation. WebRTC voice must work natively without additional software.

### BR-08 — No Data Leakage
The system must guarantee that no user's code, chat messages, credentials, or voice communications are accessible to unauthorized parties — including other room participants who have not been granted access, and any external observer on the network.

---

## 4. Functional Requirements

Each requirement is tagged: **Priority** (High / Medium / Low) | **Target** (Semester 1 / Semester 2)

---

### 4.1 User Authentication and Account Management

**FR-01** — User Registration
The system must allow a new user to register with a unique email address, a display name, and a password of at least 8 characters containing at least one uppercase letter, one lowercase letter, one digit, and one special character. The password must be hashed with bcrypt (cost factor ≥ 12) before storage. A verification email must be sent to confirm the email address before the account is activated.
Priority: High | Target: Semester 1

**FR-02** — User Login with Access and Refresh Tokens
On successful login with verified credentials, the system must issue two tokens: a short-lived JWT access token (expiry: 15 minutes) and a long-lived refresh token (expiry: 7 days) stored as an HTTP-only, Secure, SameSite=Strict cookie. The access token must be stored only in memory on the client (never in localStorage or sessionStorage). The refresh token must be stored in the database and tied to the user's device/session.
Priority: High | Target: Semester 1

**FR-03** — Silent Token Refresh
Before the access token expires, the client must silently call a `/auth/refresh` endpoint using the HTTP-only refresh token cookie to obtain a new access token. If the refresh token is expired or revoked, the user must be redirected to the login page. This must happen without any visible interruption to the user's session.
Priority: High | Target: Semester 1

**FR-04** — Refresh Token Rotation
Every time the `/auth/refresh` endpoint is called successfully, the server must invalidate the current refresh token and issue a new one (rotation). If a refresh token that has already been rotated is presented (replay attack), the server must immediately invalidate the entire refresh token family for that user and force a full re-login.
Priority: High | Target: Semester 1

**FR-05** — Brute Force and Rate Limit Protection
Login attempts must be rate-limited per IP address and per email address. After 5 consecutive failed login attempts for a given email within 10 minutes, the account must be temporarily locked for 15 minutes. The user must be notified by email. After 20 failed attempts across any accounts from a single IP within 10 minutes, that IP must be blocked for 1 hour.
Priority: High | Target: Semester 1

**FR-06** — Logout and Session Revocation
On logout, the server must immediately invalidate the user's current refresh token in the database. The client must discard the in-memory access token. The server must also clear the HTTP-only cookie. Logging out on one device must not affect sessions on other devices unless the user selects "Log out of all devices."
Priority: High | Target: Semester 1

**FR-07** — Active Session Management
Users must be able to view all active sessions (device name, IP address, last active time, approximate location). They must be able to revoke any individual session or all sessions except the current one. Each session must correspond to one refresh token entry in the database.
Priority: Medium | Target: Semester 2

**FR-08** — User Profile
Each user must have a profile containing their display name, avatar color, email address, and a list of rooms they own or have joined. Users must be able to update their display name and avatar color. Email changes must require re-verification.
Priority: Medium | Target: Semester 2

**FR-09** — Password Reset
Users must be able to request a password reset via email. The system must send a time-limited (30 minutes), single-use signed reset link. After a successful reset, all existing refresh tokens for that user must be invalidated.
Priority: High | Target: Semester 1

---

### 4.2 Room and Session Management

**FR-10** — Create Room
An authenticated user must be able to create a new coding room by providing a room name. The system must generate a unique, non-guessable room ID (UUID v4) and a shareable invite link. The creator is automatically assigned the Owner role.
Priority: High | Target: Semester 1

**FR-11** — Join Room via Invite Link
A user must be able to join a room via its invite link. They must be authenticated before entry is permitted — guest access without login is not allowed. On joining, they are assigned the Viewer role by default unless pre-approved by the Owner or Room Leader.
Priority: High | Target: Semester 1

**FR-12** — Role Hierarchy
Each room must enforce the following role hierarchy from highest to lowest authority:

| Role | Description |
|---|---|
| Owner | Created the room. Full control. Can assign/remove Room Leader. Cannot be removed. |
| Room Leader | Designated by Owner. Controls live editor access for all participants. Can grant/revoke Editor access. Can mute participants in voice. |
| Editor | Has active write access to the editor and can participate in voice/chat. |
| Viewer | Read-only access to the editor. Can participate in chat and voice (listen only unless granted speak access). |

Priority: High | Target: Semester 1

**FR-13** — Room Persistence
Room content (files, code, chat history, participant roles) must be persisted in MongoDB so users can leave and return to find their work and role assignments intact.
Priority: High | Target: Semester 1

**FR-14** — Room Listing Dashboard
Users must be able to view a dashboard listing all rooms they own or have joined, showing room name, their role, last active time, and current online participant count.
Priority: Medium | Target: Semester 2

**FR-15** — Close / Archive Room
The room Owner must be able to close a room (making it read-only and disconnecting all participants) or permanently delete it along with all associated files, chat history, and snapshots.
Priority: Low | Target: Semester 2

---

### 4.3 Room Leader and Live Access Control

This section defines the Room Leader's live session management capabilities — the feature that allows dynamic, real-time control over who can edit during an active session.

**FR-39** — Assign Room Leader
The room Owner must be able to designate any Editor or Viewer as the Room Leader at any time, including during an active session. There can be only one Room Leader per room at any time. The Owner can also revoke the Room Leader designation and reassign it.
Priority: High | Target: Semester 1

**FR-40** — Grant Editor Access to Individual User
The Room Leader (and Owner) must be able to promote any Viewer to Editor role in real time by selecting them from the participants list and clicking "Grant Access." The change must take effect immediately — the promoted user's WebSocket connection must be updated to allow document writes without requiring a reconnect.
Priority: High | Target: Semester 1

**FR-41** — Revoke Editor Access from Individual User
The Room Leader (and Owner) must be able to demote any Editor back to Viewer role in real time. The demotion must take effect immediately on the server — any subsequent document update messages from that connection must be dropped. The demoted user must receive a notification that their edit access has been removed.
Priority: High | Target: Semester 1

**FR-42** — Grant Editor Access to All
The Room Leader must be able to click a single "Grant Access to All" control that promotes all current Viewers in the room to Editor role simultaneously. This must be processed as an atomic operation on the server — all role updates must be applied before any new messages are relayed.
Priority: High | Target: Semester 1

**FR-43** — Revoke Editor Access from All
The Room Leader must be able to click a single "Remove Access from All" control that demotes all current Editors (except the Owner and Room Leader themselves) back to Viewer role simultaneously.
Priority: High | Target: Semester 1

**FR-44** — Access Change Broadcast
Whenever any role change occurs in a room (grant, revoke, single or bulk), the server must broadcast a system event to all connected clients so their UI reflects the updated participant roles in real time without requiring a page refresh.
Priority: High | Target: Semester 1

---

### 4.4 Real-Time Collaborative Editing

**FR-16** — Simultaneous Multi-User Editing
Multiple users with Editor role must be able to type in the same file simultaneously. All edits must be synchronized across all connected clients using Yjs CRDT without conflicts.
Priority: High | Target: Semester 1

**FR-17** — Conflict-Free Merge
When two Editors modify the same document position simultaneously, Yjs must merge both changes automatically without data loss. The CRDT model must guarantee eventual consistency across all clients regardless of network order.
Priority: High | Target: Semester 1

**FR-18** — Live Cursor Presence
Each connected Editor's cursor position must be broadcast to all other users in the same file using the Yjs awareness protocol. Cursors must render as colored carets labeled with the user's display name and role badge.
Priority: High | Target: Semester 1

**FR-19** — User Presence Indicators
The system must display a live participant list showing every user connected to the room with their name, avatar color, role, microphone status (muted/unmuted), and online indicator. The list must update in real time.
Priority: High | Target: Semester 1

**FR-20** — Disconnect Handling
If a user's connection drops, their cursor and presence indicator must be removed from all other clients within 5 seconds via Yjs awareness timeout. Their document edits must be preserved. On reconnect, the client must re-sync its full Yjs document state from the server without data loss.
Priority: Medium | Target: Semester 1

**FR-21** — Multi-File Support
Each room must support multiple files in a file tree. Each file has its own Y.Text instance. Users switch files without losing sync state on other files.
Priority: Medium | Target: Semester 2

---

### 4.5 Code Editor

**FR-22** — Monaco Editor Integration
The editor must use Monaco Editor for syntax highlighting, auto-indentation, bracket matching, and multi-cursor support. The editor must be read-only for Viewers and writable only for Editors and Owner.
Priority: High | Target: Semester 1

**FR-23** — Language Selection
The active file's language must be selectable from a dropdown. Supported languages: JavaScript, Python, C++, C, Java, HTML/CSS. Syntax highlighting must update instantly. Language selection maps to Judge0 language IDs for execution.
Priority: High | Target: Semester 1

**FR-24** — Theme Selection
The editor must support at least a dark and a light theme. The selected theme must persist per user across sessions in their profile.
Priority: Low | Target: Semester 2

**FR-25** — Editor Keybindings
Standard shortcuts must work: undo/redo (Ctrl+Z/Y), find (Ctrl+F), select all (Ctrl+A), comment/uncomment (Ctrl+/).
Priority: Medium | Target: Semester 1

**FR-26** — Font Size Adjustment
Users must be able to adjust editor font size from a settings panel. The setting must persist per user.
Priority: Low | Target: Semester 2

---

### 4.6 Code Execution

**FR-27** — Run Code
Editors and Owner must be able to execute the active file's code via a Run button. The system must proxy the request to Judge0 and display results in an output panel.
Priority: High | Target: Semester 2

**FR-28** — Multi-Language Execution
Execution must support: JavaScript, Python 3, C++, C, and Java via Judge0 language IDs.
Priority: High | Target: Semester 2

**FR-29** — Shared Execution Output
Execution output (stdout, stderr, exit code, execution time) must be broadcast to all users in the room via WebSocket so all participants see results simultaneously.
Priority: High | Target: Semester 2

**FR-30** — Execution Timeout
Execution is capped at 10 seconds server-side. On timeout, Judge0 must terminate the process and the output panel must display a clear timeout message.
Priority: High | Target: Semester 2

**FR-31** — Stdin Support
A text field in the output panel must allow users to provide stdin before clicking Run.
Priority: Medium | Target: Semester 2

**FR-32** — Execution Status Indicator
The Run button must show a loading/running state during execution and reset on completion or timeout.
Priority: Medium | Target: Semester 2

**FR-33** — HTML/CSS Live Preview
When the active file is `.html`, a live preview pane must render the output in a sandboxed `<iframe>` in the browser, updating as the document changes. This bypasses Judge0.
Priority: Low | Target: Semester 2

---

### 4.7 In-Room Chat

**FR-34** — Real-Time Text Chat
All users (Editors and Viewers) must be able to send and receive text messages in a chat panel in real time via WebSocket.
Priority: Medium | Target: Semester 1

**FR-35** — Chat History Persistence
Chat messages must be stored in MongoDB and loaded on room join so prior conversation is accessible.
Priority: Medium | Target: Semester 2

**FR-36** — Message Display
Each message must show the sender's display name (in their role color), message text, and timestamp.
Priority: Medium | Target: Semester 1

---

### 4.8 Voice Chat

Voice chat is implemented using WebRTC for peer-to-peer audio streams, with a signalling server on the backend using Socket.IO. Inspiration is drawn from Google Meet and Zoom for participant controls and access management.

**FR-45** — Join Voice Channel
Any user in a room may join the room's voice channel by clicking a microphone button. Joining voice is independent of editor access — a Viewer can listen in voice even if they cannot edit.
Priority: High | Target: Semester 2

**FR-46** — Leave Voice Channel
Users must be able to leave the voice channel at any time without leaving the room. Their editor session must remain active.
Priority: High | Target: Semester 2

**FR-47** — Mute / Unmute Self
Any user in the voice channel must be able to mute and unmute their own microphone at any time. Mute state must be reflected immediately in the participant list for all other users.
Priority: High | Target: Semester 2

**FR-48** — Room Leader Can Mute Participant
The Room Leader and Owner must be able to mute any specific participant in the voice channel. The muted user must receive a notification ("You were muted by the Room Leader"). The user may unmute themselves afterward unless the Room Leader applies a "hard mute."
Priority: Medium | Target: Semester 2

**FR-49** — Room Leader Hard Mute
The Room Leader must be able to apply a "hard mute" on a participant that prevents them from unmuting themselves until the Room Leader releases it. This mirrors the "mute all" instructor control in Zoom.
Priority: Medium | Target: Semester 2

**FR-50** — Mute All
The Room Leader must be able to mute all participants simultaneously with a single "Mute All" control. Individual users may unmute themselves after this unless individually hard-muted.
Priority: Medium | Target: Semester 2

**FR-51** — Voice Access Control
The Room Leader may restrict voice channel joining to Editors only, preventing Viewers from entering voice. This setting must be togglable during an active session.
Priority: Low | Target: Semester 2

**FR-52** — Speaking Indicator
While a user is actively speaking (audio level above threshold), a visual indicator (animated ring or icon) must appear next to their name in the participant list — visible to all users in the room. This mirrors the speaking indicator in Google Meet.
Priority: Medium | Target: Semester 2

**FR-53** — WebRTC Signalling Server
The backend must provide a Socket.IO-based signalling server to coordinate WebRTC peer connections (SDP offer/answer exchange and ICE candidate relay). A STUN server (Google's public STUN or self-hosted) must be configured. A TURN server must be available as a fallback for participants behind symmetric NAT.
Priority: High | Target: Semester 2

---

### 4.9 Version History

**FR-37** — Automatic Snapshots
The server must automatically save a snapshot of the room's Y.Doc state to MongoDB every 10 minutes, and also on any manual trigger by the Owner.
Priority: Low | Target: Semester 2

**FR-38** — Snapshot Restore
The Owner must be able to view a timestamped snapshot list and restore the room's files to any prior snapshot.
Priority: Low | Target: Semester 2

---

### 4.10 File Management

**FR-54** — Create File
Editors and Owner must be able to create a new file in the room file tree with a specified name and extension.
Priority: Medium | Target: Semester 2

**FR-55** — Rename File
The Owner must be able to rename any file. The change must propagate to all connected clients immediately.
Priority: Low | Target: Semester 2

**FR-56** — Delete File
The Owner must be able to delete a file. Deletion must propagate to all clients and remove the associated Y.Text from the Yjs document.
Priority: Low | Target: Semester 2

**FR-57** — Export File
Any user must be able to download the active file as a plain text file with the correct extension.
Priority: Medium | Target: Semester 2

---

## 5. Non-Functional Requirements

---

### 5.1 Performance

**NFR-01** — Sync Latency
Yjs document updates must propagate to all clients in the same room within 200ms under normal broadband conditions.

**NFR-02** — Editor Load Time
Monaco Editor and all JavaScript bundles must be interactive within 4 seconds on a standard broadband connection.

**NFR-03** — Execution Response Time
For programs under 100 lines with no I/O loops, execution results must appear within 5 seconds of clicking Run.

**NFR-04** — Concurrent Users per Room
The system must support at least 10 simultaneous users per room (editing + voice) without sync performance degradation.

**NFR-05** — WebSocket Throughput
The relay server must handle at least 100 WebSocket messages per second per room without loss or reordering.

**NFR-06** — Voice Latency
End-to-end voice latency for users on the same regional network must not exceed 150ms under normal conditions. This is the WebRTC peer-to-peer target, not server-relayed.

---

### 5.2 Reliability

**NFR-07** — Automatic WebSocket Reconnection
On connection drop, the client must reconnect with exponential backoff (initial 1s, max 30s). On reconnect, full Yjs document state must be re-synced without data loss.

**NFR-08** — Data Durability
All room content stored in MongoDB must survive server restarts. Yjs document state must be persisted using a debounced write strategy: writes are triggered after 2000ms of inactivity to avoid excessive I/O on rapid keystrokes.

**NFR-09** — CRDT Consistency
Yjs must guarantee that all clients converge to the same document state after all pending operations are delivered, regardless of delivery order.

**NFR-10** — Voice Reconnection
If a WebRTC peer connection fails, the client must automatically attempt to renegotiate the connection. If renegotiation fails after 3 attempts, the user must be notified and offered a manual rejoin option.

---

### 5.3 Security — Authentication and Session

**NFR-11** — Short-Lived Access Tokens
JWT access tokens must expire after 15 minutes. They must be signed with RS256 (asymmetric) rather than HS256 so the private signing key is never exposed to client-facing services.

**NFR-12** — Refresh Token Storage
Refresh tokens must be stored exclusively in HTTP-only, Secure, SameSite=Strict cookies. They must never appear in response bodies, URLs, or JavaScript-accessible storage. Server-side, each refresh token must be stored as a bcrypt hash — the plaintext token must not be stored.

**NFR-13** — Refresh Token Rotation and Reuse Detection
Every refresh generates a new token and invalidates the old one. Presentation of an already-rotated token must trigger invalidation of the entire session family and force full re-authentication. This prevents refresh token theft and replay.

**NFR-14** — Brute Force Prevention
Login endpoints must enforce: per-email lockout after 5 failed attempts in 10 minutes (lockout: 15 minutes); per-IP block after 20 failed attempts across any accounts in 10 minutes (block: 1 hour). All lockout and block events must be logged with timestamp and IP.

**NFR-15** — CSRF Protection
All state-changing API endpoints must require a CSRF token or use the SameSite=Strict cookie policy with double-submit cookie pattern to prevent cross-site request forgery.

**NFR-16** — Password Policy Enforcement
Passwords must meet minimum complexity (8+ chars, uppercase, lowercase, digit, special character). The system must check submitted passwords against the HaveIBeenPwned API (k-anonymity model) and reject known-breached passwords without transmitting the full password.

---

### 5.4 Security — WebSocket and Real-Time Layer

**NFR-17** — WebSocket Authentication on Handshake
Every WebSocket connection must present a valid, non-expired JWT access token during the HTTP upgrade handshake. Connections without a valid token must be rejected before the WebSocket is established.

**NFR-18** — Server-Side Role Enforcement on Every Message
The WebSocket relay server must check the sender's current role on every incoming Yjs document update message before relaying it. Messages from Viewer-role connections must be silently dropped. Role state must be read from an in-memory session store (not re-queried from the database on every message) to avoid database bottlenecks while remaining current after live role changes.

**NFR-19** — Role Change Propagation
When the Room Leader changes a user's role, the in-memory session store must be updated atomically before the role-change event is broadcast to clients. This prevents a race condition where a newly demoted user's in-flight messages are relayed after demotion.

**NFR-20** — Message Size Limits
The WebSocket server must reject any single message exceeding 512KB. This prevents memory exhaustion from malformed or malicious oversized Yjs update payloads.

---

### 5.5 Security — Data Leakage Prevention

**NFR-21** — Transport Encryption (TLS)
All HTTP and WebSocket traffic must be encrypted with TLS 1.2 minimum (TLS 1.3 preferred). Plain HTTP and WS connections must be redirected to HTTPS/WSS. TLS certificates must be obtained via Let's Encrypt and auto-renewed.

**NFR-22** — Sensitive Field Encryption at Rest
Sensitive database fields (email addresses, IP address logs, session metadata) must be encrypted at rest using AES-256-GCM at the application layer before writing to MongoDB. Encryption keys must be stored in environment variables, not in the database or source code.

**NFR-23** — No Sensitive Data in Logs
Application logs must never contain passwords, JWT tokens, refresh tokens, raw email addresses, or code content. Log entries must use user IDs and room IDs as identifiers. Log files must be stored with restricted filesystem permissions (chmod 640).

**NFR-24** — No PII in JWT Payload
JWT access tokens must contain only: user ID, token expiry, and token type. They must not contain email addresses, display names, IP addresses, or role information. Role and profile data must be fetched from the server on demand.

**NFR-25** — Room Data Isolation
The database schema and API must guarantee that a user can only access data (files, chat, snapshots) for rooms they are a member of. All database queries for room data must include the requesting user's ID as a filter condition — there must be no "get all rooms" or "get room by ID" endpoint without membership verification.

**NFR-26** — Code Content Privacy
User-submitted code must not be logged, cached in plaintext outside of the room's Yjs document, or transmitted to any third party other than the Judge0 execution sandbox. Judge0 submissions must not include user-identifying metadata.

**NFR-27** — Secrets Management
All secrets (JWT private key, MongoDB URI, Judge0 API key, TURN server credentials, encryption keys) must be stored in environment variables loaded from a `.env` file excluded from version control via `.gitignore`. No secrets may be hardcoded in any source file. In production, secrets must be injected via the deployment platform's secret management system (e.g., Railway environment variables, Docker secrets).

**NFR-28** — Security Headers
All HTTP responses must include: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy` (restricting script sources to self and trusted CDNs), and `Referrer-Policy: no-referrer`. These must be enforced via the `helmet` middleware on the Express server.

---

### 5.6 Security — Voice Chat

**NFR-29** — Encrypted Voice Streams
All WebRTC audio streams must be encrypted using DTLS-SRTP, which is mandatory in all modern WebRTC implementations. No unencrypted audio must be transmitted.

**NFR-30** — TURN Server Credential Security
TURN server credentials issued to clients must be time-limited (expiry: 1 hour) and generated server-side using HMAC. Credentials must be unique per user per session and must not be reusable after expiry.

**NFR-31** — No Voice Recording
The system must not record, store, or relay audio streams through the server (except for TURN relay when required by NAT). Voice data must be peer-to-peer only. No audio data may be written to disk or database at any point.

---

### 5.7 Server Infrastructure and Load Management

Inspired by the server-side architecture of Google Meet and Zoom, the following requirements govern how the server handles load, distributes connections, protects resources, and stays responsive under peak usage.

**NFR-32** — Process Management with PM2
The Node.js server must run under PM2 in cluster mode, spawning one worker process per available CPU core. PM2 must automatically restart crashed workers and must be configured to restart workers that exceed 512MB memory usage. PM2 logs must be rotated daily and retained for 14 days.

**NFR-33** — Reverse Proxy with Nginx
All incoming traffic must pass through an Nginx reverse proxy before reaching the Node.js application. Nginx handles: TLS termination, HTTP to HTTPS redirection, WebSocket upgrade proxying (`Upgrade` and `Connection` headers), static file serving (client bundle, assets), and connection rate limiting at the network layer.

**NFR-34** — Connection Rate Limiting at Proxy Layer
Nginx must enforce: a maximum of 20 new HTTP connections per second per IP (`limit_req`), a maximum of 100 concurrent connections per IP (`limit_conn`). These limits protect against connection floods before requests reach Node.js.

**NFR-35** — API Rate Limiting at Application Layer
The Express application must enforce per-user and per-IP rate limits using `express-rate-limit` with a Redis (or in-memory) store:
- Auth endpoints (login, register, refresh): 10 requests per minute per IP
- Code execution endpoint: 10 requests per minute per user
- General API endpoints: 100 requests per minute per user
Responses exceeding the limit must return HTTP 429 with a `Retry-After` header.

**NFR-36** — WebSocket Connection Limits per Room
The server must enforce a maximum of 20 simultaneous WebSocket connections per room. Connection attempts beyond this limit must be rejected with a clear error message. This prevents a single room from consuming disproportionate server resources.

**NFR-37** — Memory-Efficient Yjs Document Management
Yjs documents for inactive rooms (no connected clients for more than 30 minutes) must be unloaded from server memory and persisted to the database. When the next client connects to that room, the document must be reloaded from the database. This prevents unbounded memory growth as the number of rooms increases.

**NFR-38** — Graceful Shutdown
The server must handle `SIGTERM` and `SIGINT` signals gracefully: stop accepting new connections, complete in-flight requests (timeout: 10 seconds), persist all in-memory Yjs document states to the database, then exit. This prevents data loss during deployments and server restarts.

**NFR-39** — Health Check Endpoint
The server must expose a `GET /health` endpoint that returns HTTP 200 with a JSON payload containing: server uptime, memory usage, active room count, and active WebSocket connection count. This endpoint must be unauthenticated and used by the process manager and any monitoring tool to verify server health.

**NFR-40** — Database Connection Pooling
The MongoDB connection must use Mongoose with a configured connection pool (min: 5, max: 20 connections). Idle connections must time out after 30 seconds. The pool size must be tunable via environment variable without code changes.

**NFR-41** — Static Asset Caching
The Nginx reverse proxy must serve the React frontend bundle and static assets with `Cache-Control: public, max-age=31536000, immutable` for versioned filenames (content-hashed by the build tool). The HTML entry point must use `Cache-Control: no-cache` to ensure users always get the latest version.

**NFR-42** — Compression
Nginx must enable gzip or Brotli compression for all text-based responses (HTML, JS, CSS, JSON) above 1KB. This reduces bandwidth and improves load times for the client bundle, which includes the Monaco Editor.

**NFR-43** — Resource Limits on Judge0 Execution
Each Judge0 code submission must be configured with hard resource limits: maximum CPU time 10 seconds, maximum wall clock time 12 seconds, maximum memory 128MB, maximum output size 64KB. These limits must be enforced by Judge0 at the container level and cannot be overridden by user input.

---

### 5.8 Usability

**NFR-44** — Zero Client Installation
The complete application including voice chat must run in a modern browser with no plugins or extensions. WebRTC audio must work natively.

**NFR-45** — Intuitive Onboarding
A new user must be able to register, create a room, and begin a collaborative session within 3 minutes without documentation.

**NFR-46** — Responsive Feedback
Every user action must produce visible feedback within 300ms — a result, a loading indicator, or an error message.

**NFR-47** — Error Messaging
All errors must be shown in plain English. No raw error codes, stack traces, or internal identifiers may be exposed to the user.

---

### 5.9 Maintainability

**NFR-48** — Modular Backend Architecture
The backend must be structured as independent modules: auth, rooms, websocket-relay, execution, voice-signalling, and infrastructure (rate limiting, health checks). Each module must be independently testable.

**NFR-49** — Environment-Based Configuration
All environment-specific values must be stored in `.env`. No values may be hardcoded. The application must fail fast on startup if required environment variables are missing, with a clear error message identifying the missing variable.

**NFR-50** — Code Documentation
All public functions and modules must have JSDoc comments. The WebSocket message protocol and role enforcement logic must have inline comments explaining the security reasoning.

---

### 5.10 Scalability

**NFR-51** — Stateless REST API
The REST API must be stateless (session state in tokens and DB, not server memory) so it can scale horizontally.

**NFR-52** — Room Isolation
A crash or resource spike in one room must not affect other rooms. Each room's Yjs document and WebSocket client set must be independently managed.

**NFR-53** — Horizontal Scaling Readiness
The WebSocket relay and signalling server must be designed to support a Redis pub/sub adapter (e.g., `socket.io-redis`) for scaling across multiple Node.js instances in the future. The architecture must not assume single-process state for message routing.

---

### 5.11 Compatibility

**NFR-54** — Browser Support
Full functionality (editor, collaboration, voice) must work on the latest stable versions of Chrome, Firefox, and Edge on Windows, macOS, and Linux.

**NFR-55** — Minimum Screen Resolution
The UI must be fully usable at 1280×720px minimum. Panel layout must not break or overflow at this resolution.

---

## 6. System Constraints

**SC-01** — The system must be deployable on a single Linux VPS with minimum 2 vCPUs and 4GB RAM to support Node.js (PM2 cluster), MongoDB, Nginx, Judge0, and a TURN server simultaneously.

**SC-02** — The final FYP implementation must use the following stack: React (frontend), Node.js + Express (backend), MongoDB (database), Yjs (CRDT sync), Monaco Editor, Judge0 (execution), WebRTC + Socket.IO (voice signalling), Nginx (reverse proxy), PM2 (process management). The current proof-of-concept is Vanilla JS and is a throwaway prototype — it is not the deliverable. Substitutions to the above stack require supervisor approval.

**SC-03** — The system must not rely on any paid third-party services with ongoing fees. All components must be open-source and self-hostable.

**SC-04** — The project must be complete and defense-ready by end of Semester 2, 2025–2026 academic year.

**SC-05** — The UI design is explicitly out of scope for this document. The current PoC UI will be discarded. UI/UX decisions will be captured in a separate specification. This document governs backend behaviour, data flow, security, and system architecture only.

---

## 7. Assumptions and Dependencies

### Assumptions

- Users access the system from desktop/laptop computers with stable internet. Voice chat is not designed for mobile browsers.
- A minimum of two users will be available for the defense demo to demonstrate real-time collaboration and voice.
- The deployment server allows inbound TCP on ports 80, 443, 3000 (app), 3478 (TURN/STUN), and outbound connections for Judge0.
- The university network does not block WebRTC traffic (UDP ports for ICE candidates). If it does, TURN relay will be required.
- The supervisor and committee understand the Google Docs analogy for CRDT-based editing and do not need a full theoretical explanation in the demo.

### External Dependencies

| Dependency | Purpose | Fallback if Unavailable |
|---|---|---|
| Yjs + y-websocket | CRDT document sync | No direct substitute — core feature |
| Monaco Editor | Code editing engine | CodeMirror 6 |
| Judge0 (self-hosted) | Sandboxed code execution | Browser-only JS execution for demo |
| MongoDB | Primary database | PostgreSQL + Prisma |
| Node.js v18+ | Server runtime | Required — no alternative |
| Docker | Judge0 container isolation | Required for self-hosted Judge0 |
| WebRTC (browser-native) | Peer-to-peer voice | Required — no plugin substitute |
| Socket.IO | WebRTC signalling + room events | ws library (lower-level fallback) |
| Nginx | Reverse proxy, TLS, compression | Caddy (simpler alternative) |
| PM2 | Process management, clustering | systemd (no clustering) |
| STUN server (Google public) | WebRTC NAT traversal | Self-hosted coturn |
| TURN server (coturn, self-hosted) | WebRTC fallback relay behind NAT | Required for symmetric NAT users |
| Let's Encrypt (certbot) | TLS certificate | Self-signed (dev only) |

---

*Document prepared for BSE Final Year Project*
*Bahria University Karachi Campus — Department of Software Engineering*
*Version 1.2 — July 2026*
