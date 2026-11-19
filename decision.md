# CollabIDE — Architectural Decision Log (decision.md)

This document records the architectural and engineering decisions made across the **CollabIDE** codebase. It explains **what** was decided, **why** it was decided, **what alternatives were rejected**, and **how each system works under the hood** in clear, approachable terms.

---

## Table of Contents
1. [System Architecture Overview](#1-system-architecture-overview)
2. [Decision 1: Process Management & Clustered Execution (NFR-32)](#decision-1-process-management--clustered-execution-nfr-32)
3. [Decision 2: Atomic Brute-Force Lockout & Sliding Windows (NFR-14)](#decision-2-atomic-brute-force-lockout--sliding-windows-nfr-14)
4. [Decision 3: Zero-Leak Fail-Fast Startup & Real CSPRNG Secrets (NFR-49)](#decision-3-zero-leak-fail-fast-startup--real-csprng-secrets-nfr-49)
5. [Decision 4: Multi-Tier Static Asset Caching & Offline Precompression (NFR-41)](#decision-4-multi-tier-static-asset-caching--offline-precompression-nfr-41)
6. [Decision 5: Graceful Shutdown with Watchdog Persistence Buffer (NFR-38)](#decision-5-graceful-shutdown-with-watchdog-persistence-buffer-nfr-38)
7. [Decision 6: Refresh Token Rotation & Session Family Theft Detection (NFR-13)](#decision-6-refresh-token-rotation--session-family-theft-detection-nfr-13)
8. [Decision 7: Database Connection Pooling & CMAP Monitoring (NFR-40)](#decision-7-database-connection-pooling--cmap-monitoring-nfr-40)
9. [Decision 8: WebSocket Per-Room Connection Limits & Room Isolation (NFR-36 & NFR-52)](#decision-8-websocket-per-room-connection-limits--room-isolation-nfr-36--nfr-52)
10. [Decision 9: Double-Submit CSRF Defense with Strict SameSite (NFR-15)](#decision-9-double-submit-csrf-defense-with-strict-samesite-nfr-15)
11. [Decision 10: Modular Backend Domain Decoupling (NFR-48)](#decision-10-modular-backend-domain-decoupling-nfr-48)
12. [Summary Quick-Reference Table](#summary-quick-reference-table)

---

## 1. System Architecture Overview

CollabIDE is a real-time collaborative development environment. It pairs simultaneous code editing, code execution sandboxing, live chat, and WebRTC voice channels.

```
                    ┌────────────────────────┐
                    │ Client (Vite / React)  │
                    └───────────┬────────────┘
                                │ HTTPS / WSS
                                ▼
                    ┌────────────────────────┐
                    │   Reverse Proxy / CDN  │
                    │  (Nginx / Static Host) │
                    └───────────┬────────────┘
                                │
                    ┌───────────┴────────────┐
                    ▼                        ▼
        ┌─────────────────────────┐   ┌────────────────────────┐
        │  PM2 Cluster (Node.js)  │   │ Precompressed Assets   │
        │  Worker 1 ... Worker N  │   │ (.br / .gz sidecars)   │
        └───────────┬─────────────┘   └────────────────────────┘
                    │
      ┌─────────────┼─────────────┬────────────────┐
      ▼             ▼             ▼                ▼
┌───────────┐ ┌───────────┐ ┌───────────┐  ┌──────────────┐
│  MongoDB  │ │ Yjs CRDT  │ │  Judge0   │  │ WebRTC Voice │
│   Atlas   │ │ In-Memory │ │ Execution │  │ (Coturn STUN/│
│  (Pool)   │ │ Document  │ │  Sandbox  │  │    TURN)     │
└───────────┘ └───────────┘ └───────────┘  └──────────────┘
```

Because of high concurrency (multiple developers editing identical documents simultaneously), every architectural choice prioritizes:
- **Zero Race Conditions**: Database updates must be atomic; memory mutations must not lose writes.
- **Fail-Fast Safety**: Invalid configurations crash the server immediately before serving user requests.
- **High Throughput / Low CPU**: Expensive work (like Brotli compression) is pre-computed offline.

---

## Decision 1: Process Management & Clustered Execution (NFR-32)

### The Problem
Node.js runs on a single thread. By default, running `node server.js` on an 8-core server wastes 7 cores (87.5% idle capacity). Furthermore, if an unhandled error or memory leak spikes memory, the entire server process would crash, kicking off every active developer.

### The Alternatives Considered
1. *Rely on Docker/Kubernetes container replicas alone*: Adds operational complexity, heavier memory overhead per container, and doesn't handle in-process Node memory ceiling recycling gracefully.
2. *Simple PM2 fork mode*: Uses only 1 core; crashes still take down the entire user base while restarting.

### The Decision We Made
We adopted **PM2 in Cluster Mode** with strictly defined resource fences in [ecosystem.config.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/ecosystem.config.js):
- **Full Core Utilization**: `instances: process.env.PM2_WORKERS || 'max'` dynamically spawns one worker process per logical CPU core.
- **512MB Memory Restart Boundary**: `max_memory_restart: '512M'` ensures any worker that leaks memory is recycled before it threatens the host system.
- **Crash Recovery with Backoff**: `autorestart: true`, `min_uptime: 5000`, `max_restarts: 3`, and `exp_backoff_restart_delay: 1000` automatically restart crashed workers while preventing infinite reboot loops if a crash is systemic.
- **Strict Separation of Log Ownership**:
  - `pm2-logrotate` exclusively rotates PM2 stdout/stderr files (`pm2-out.log`, `pm2-error.log`).
  - [utils/logRotator.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/utils/logRotator.js) exclusively rotates internal application logs (`app.log`, `error.log`, `audit.log`).
  - Files are truncated in-place using `fs.truncateSync(filePath, 0)` so existing file descriptors held by running processes never point to deleted inodes.
  - Old archives older than 14 calendar days are purged daily.

---

## Decision 2: Atomic Brute-Force Lockout & Sliding Windows (NFR-14)

### The Problem
Automated credential-stuffing attacks send hundreds of rapid login requests per second. We needed:
1. Per-email lockout after 5 failed attempts within 10 minutes (15-minute lock).
2. Per-IP block after 20 failed attempts within 10 minutes (1-hour block).

### The Flaw We Discovered & Fixed
The naive implementation in Mongoose was:
```javascript
// DANGEROUS READ-MODIFY-WRITE PATTERN
const user = await User.findOne({ email });
user.loginAttempts += 1;
await user.save();
```
**Why this breaks:** If an attacker fires 10 requests concurrently, all 10 requests read `loginAttempts = 0`, compute `0 + 1 = 1`, and write `loginAttempts = 1`. Nine real failed attempts silently evaporate! The attacker could make 50 attempts without ever getting locked out.

### The Decision We Made
We implemented **atomic MongoDB updates** with `$inc` and conditional locking in [collab-ide/routes/auth.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/routes/auth.js) and [collab-ide/models/IpBlock.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/models/IpBlock.js):
- **Atomic Counter Increment**: We use `User.findOneAndUpdate` and `IpBlock.findOneAndUpdate` with `$inc: { loginAttempts: 1 }` or `$inc: { failedAttempts: 1 }`. The database engine serializes these increments at the document lock level.
- **Sliding Window Boundary**: If the sliding window (`10 minutes`) has expired, the update atomically resets the count to `1` and starts a fresh `windowStart`.
- **Pre-Auth Early Exit**: Before even touching password hashing (bcrypt), the login handler checks if the account or IP is currently locked (`lockUntil > Date.now()` or `blockUntil > Date.now()`). If locked, it immediately returns HTTP 403 / HTTP 429 without doing any expensive CPU crypto.
- **No In-Memory Reset Races**: Successful logins atomically clear `loginAttempts: 0`, `loginAttemptsWindowStart: undefined`, and `lockUntil: undefined`.

---

## Decision 3: Zero-Leak Fail-Fast Startup & Real CSPRNG Secrets (NFR-49)

### The Problem
During development, repositories often accumulate hardcoded secrets, weak placeholder keys (like `"change-me-secret-123"`), or weak fallback keys in source control. If an application boots with missing or weak keys, it can silently run in a vulnerable state.

### The Flaw We Caught & Rejected
An early proposal suggested computing a deterministic SHA-256 digest of a dev string (`sha256('collabide-default-dev-field-encryption-key-2026')`) if `FIELD_ENCRYPTION_KEY` was missing, claiming it was "zero data loss."
**Why we rejected this:** SHA-256 is a public, deterministic mathematical function. Anyone reading git history can compute the exact same 64-hex string in one second. A deterministic "fallback" key is indistinguishable from a hardcoded plaintext backdoor.

### The Decision We Made
We built a strict **Fail-Fast Environment Validator** in [collab-ide/config/env.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/config/env.js):
- **Zero Insecure Defaults**: If any production secret (`MONGODB_URI`, `FIELD_ENCRYPTION_KEY`, `TURN_SECRET`, `JWT_PRIVATE_KEY_PATH`) is missing, invalid, or matches known weak placeholders, the server prints a red multi-error diagnostic banner and calls `process.exit(1)`.
- **True 256-Bit Cryptographic Strength**: Secrets must be generated using real cryptographically secure pseudorandom numbers (`openssl rand -hex 32` or `crypto.randomBytes(32)`).
- **Sanitized Cloud Configs**: `render.yaml` was converted to `sync: false` for all credentials so production secrets are never committed to git.
- **Cryptographic Key Rotation Utility**: In [collab-ide/scripts/rotate_encryption_key.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/scripts/rotate_encryption_key.js), we implemented an offline re-encryption engine that derives new keys using HKDF and re-computes HMAC blind indexes across MongoDB documents without downtime.

---

## Decision 4: Multi-Tier Static Asset Caching & Offline Precompression (NFR-41)

### The Problem
Modern web apps serve heavy bundles (Monaco Editor, React, Yjs). If users download uncompressed JavaScript on every page reload, bandwidth costs soar, and Time-to-Interactive (TTI) degrades on mobile connections. Furthermore, compressing files on-the-fly using Node CPU spikes CPU load during traffic surges.

### The Decision We Made
We implemented a **Multi-Tier Caching & Precompression Pipeline**:
1. **Content-Hashed Assets (1-Year Immutable)**:
   - Built files like `assets/index-D7b39a.js` include content hashes in their filename.
   - We serve them with:
     ```http
     Cache-Control: public, max-age=31536000, immutable
     ```
   - Browsers cache these files permanently. They never send another HTTP request for them.
2. **HTML Entry Points (Zero Stale Cache)**:
   - `index.html` references the latest hashed asset filenames. If `index.html` were cached for a year, users would never receive updates when a new build is deployed.
   - We serve `index.html` with:
     ```http
     Cache-Control: no-cache, must-revalidate
     ```
   - The browser always checks with the server before using the HTML file, ensuring instant deployment updates.
3. **Build-Time Precompression (`scripts/precompress.js`)**:
   - Instead of compressing files at runtime, our build script [frontend/scripts/precompress.js](file:///c:/Users/maazt/Documents/Collab-IDE/frontend/scripts/precompress.js) generates `.br` (Brotli level 11) and `.gz` (Gzip level 9) sidecars for every asset > 1KB.
   - Nginx (via `gzip_static on;`) and Express serve these precompressed sidecars directly from disk with **0% runtime CPU usage**.

---

## Decision 5: Graceful Shutdown with Watchdog Persistence Buffer (NFR-38)

### The Problem
In CollabIDE, collaborative code changes live in in-memory Yjs binary documents. When a server restarts or scales down, terminating the process abruptly (`kill -9`) loses every in-memory document edit that hasn't finished flushing to MongoDB.

### The Decision We Made
We implemented an **orchestrated Graceful Shutdown Lifecycle** in [collab-ide/server.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/server.js):
1. **Immediate Ingress Cutoff**: On `SIGTERM` or `SIGINT`, the server immediately stops accepting new connections:
   - HTTP server rejects new requests with `HTTP 503 Service Unavailable`.
   - `/health` endpoint immediately switches from `200 { status: 'healthy' }` to `503 { status: 'shutting_down' }`.
2. **Clean Client Disconnect**: Connected WebSockets are sent close code `1001 (Going Away)`, instructing clients to reconnect to healthy peer workers.
3. **Concurrent Document Flushing**: All active in-memory Yjs document buffers are flushed concurrently to MongoDB Atlas using `Promise.allSettled`.
4. **The Watchdog Timing Buffer**:
   - Internal Application Watchdog: **10.0 seconds** (forces exit if a database write hangs).
   - PM2 Ecosystem `kill_timeout`: **12.0 seconds** ([ecosystem.config.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/ecosystem.config.js)).
   - **Why this difference matters**: The 2.0-second safety buffer guarantees that the application's internal diagnostics and flush operations complete cleanly *before* PM2 forcefully issues a kernel `SIGKILL`.

---

## Decision 6: Refresh Token Rotation & Session Family Theft Detection (NFR-13)

### The Problem
If a refresh token is stolen by an attacker (e.g., via malware or network interception), the attacker can generate new access tokens forever without the user knowing.

### The Decision We Made
We implemented **Chained Refresh Token Rotation with Automatic Family Revocation** in [collab-ide/routes/auth.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/routes/auth.js):
- **Single-Use Refresh Tokens**: Every time `/api/auth/refresh` is called, the old refresh token is marked as `isRotated: true`, and a brand new refresh token is issued.
- **Session Family Tracking**: Every login establishes a unique `familyId`. All subsequent rotated tokens inherit that `familyId`.
- **Theft / Replay Detection**: If a previously-rotated token is ever presented again (which happens when either an attacker uses a stolen token or the legitimate user uses an old token after an attacker already rotated it), the backend recognizes an attack:
  - It **immediately deletes every token in that entire `familyId`**.
  - Both the attacker and the victim are logged out instantly.
  - The victim is required to re-authenticate with their password.
- **Race Condition Prevention**: We added a small grace window and atomic database updates so that if two browser tabs trigger `/refresh` at the exact same millisecond, they do not trigger a false-positive replay lockout.

---

## Decision 7: Database Connection Pooling & CMAP Monitoring (NFR-40)

### The Problem
Opening a TCP socket and TLS handshake to MongoDB Atlas takes 100ms–300ms. If the server opened a new connection for every incoming HTTP request, database latency would dominate total response time, and MongoDB Atlas would run out of connection handles.

### The Decision We Made
We configured a **Persistent Connection Pool** with Mongoose in [collab-ide/config/db.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/config/db.js):
- `minPoolSize: 5`: Keeps 5 pre-authenticated sockets hot and ready at all times (eliminating cold-start latency).
- `maxPoolSize: 20`: Prevents a single worker process from consuming too many connections on MongoDB Atlas.
- `maxIdleTimeMS: 30000`: Cleans up excess idle sockets after 30 seconds of quiet traffic.
- **Connection Pool Monitoring (CMAP)**: Configured connection pool event listeners (`connectionCreated`, `connectionClosed`, `connectionCheckOutFailed`) to log pool exhaustion warnings before traffic drops occur.

---

## Decision 8: WebSocket Per-Room Connection Limits & Room Isolation (NFR-36 & NFR-52)

### The Problem
Yjs uses Conflict-Free Replicated Data Types (CRDTs). When a developer types a character, that update is broadcast to other peers in the room. In peer-to-peer sync, message fan-out scales with $O(N^2)$ network traffic. If 200 users joined a single room, the broadcast volume would saturate server bandwidth and cause input lag.

### The Decision We Made
We enforced **Hard Room Fences** in [collab-ide/services/roomManager.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/services/roomManager.js) and [collab-ide/modules/websocket-relay/index.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/modules/websocket-relay/index.js):
- **20-Connection Ceiling (NFR-36)**: A room strictly rejects connection attempts beyond 20 concurrent WebSockets with policy violation code `1008`.
- **In-Memory Document Isolation (NFR-52)**: Every room has its own isolated `Y.Doc` instance. Edits in Room A cannot bleed into Room B.
- **Role-Based Execution Restrictions**: Only room members with `Owner`, `Room Leader`, or `Editor` roles are permitted to trigger code execution. `Viewer` roles are blocked at the route handler level before reaching the execution runner.

---

## Decision 9: Double-Submit CSRF Defense with Strict SameSite (NFR-15)

### The Problem
Cross-Site Request Forgery (CSRF) occurs when an attacker tricks an authenticated user's browser into executing unwanted actions (e.g., submitting code, deleting a room, changing passwords) on a trusted site where the user is currently authenticated.

### The Decision We Made
We implemented a **Defense-in-Depth CSRF Architecture** in [collab-ide/middleware/csrf.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/middleware/csrf.js):
1. **SameSite=Strict Cookies**: Authentication cookies (`accessToken`, `refreshToken`) are flagged with `SameSite=Strict`. Modern browsers will not send these cookies on cross-site requests (e.g., if a user clicks a malicious link from an external email or site).
2. **Double-Submit Token Pattern**:
   - The server issues a cryptographically random CSRF token stored in a readable cookie (`_csrf`).
   - For all state-changing HTTP requests (`POST`, `PUT`, `DELETE`, `PATCH`), the client must read that token and send it in a custom header: `X-CSRF-Token`.
   - An external attacker's website cannot read cookies from our domain due to browser Same-Origin Policy (SOP), so they cannot populate the required `X-CSRF-Token` header.
3. **Safe Method Exemption**: Read-only methods (`GET`, `HEAD`, `OPTIONS`) are exempt from CSRF checks per HTTP/1.1 RFC specifications.

---

## Decision 10: Modular Backend Domain Decoupling (NFR-48)

### The Problem
As projects grow, monolithic server files accumulate tightly coupled dependencies. A change in voice chat could accidentally break authentication or code execution.

### The Decision We Made
We decoupled the backend into six distinct domain modules in [collab-ide/modules/](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/modules/):

| Module | Purpose |
| :--- | :--- |
| **`auth`** | User registration, bcrypt authentication, JWT issuance, token rotation, password policy enforcement. |
| **`rooms`** | Workspace lifecycle, member roles, room permissions, in-memory active document tracking. |
| **`websocket-relay`** | Yjs sync protocol relay, frame size filtering (512KB cap), connection limits, presence awareness. |
| **`execution`** | Judge0 code sandbox integration, language runtime validation, execution history, timeouts. |
| **`voice-signalling`** | WebRTC signaling over Socket.IO, Coturn TURN/STUN HMAC credential generation, mute state sync. |
| **`infrastructure`** | Environment validation, database pooling, Winston/custom logging, encryption-at-rest, rate limiting. |

**Key Invariant**: Modules export clear public interfaces and communicate through defined service contracts. Circular dependencies (`Module A -> Module B -> Module A`) are strictly banned and validated in automated test suites.

---

## Summary Quick-Reference Table

| Area | Requirement | Core Engineering Decision | Key File(s) |
| :--- | :---: | :--- | :--- |
| **Process Management** | NFR-32 | PM2 cluster mode (`instances: 'max'`), 512MB memory restart, dual-rotator isolation. | [ecosystem.config.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/ecosystem.config.js), [utils/logRotator.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/utils/logRotator.js) |
| **Brute Force Defense** | NFR-14 | Atomic MongoDB `$inc` updates, 5 attempts/10m $\to$ 15m lock, 20 attempts/10m $\to$ 1h IP block. | [routes/auth.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/routes/auth.js), [models/IpBlock.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/models/IpBlock.js) |
| **Configuration** | NFR-49 | Fail-fast startup validator, accumulated error banner, real 256-bit CSPRNG secrets. | [config/env.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/config/env.js), [scripts/rotate_encryption_key.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/scripts/rotate_encryption_key.js) |
| **Static Caching** | NFR-41 | 1-year immutable hashed assets, `no-cache` HTML, build-time `.br` / `.gz` sidecars. | [frontend/scripts/precompress.js](file:///c:/Users/maazt/Documents/Collab-IDE/frontend/scripts/precompress.js) |
| **Graceful Shutdown** | NFR-38 | 503 ingress cutoff, WebSocket 1001 close, concurrent Yjs MongoDB flush, 10s watchdog vs 12s PM2 kill buffer. | [server.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/server.js), [ecosystem.config.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/ecosystem.config.js) |
| **Token Security** | NFR-13 | Chained refresh token rotation, session family theft invalidation, HttpOnly SameSite=Strict cookies. | [routes/auth.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/routes/auth.js) |
| **Database Pool** | NFR-40 | Persistent Mongoose pool (`min: 5`, `max: 20`, `idleTimeout: 30s`) with CMAP event telemetry. | [config/db.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/config/db.js) |
| **Room Concurrency** | NFR-36 & 52 | 20 WebSocket per-room limit, isolated in-memory Y.Doc instances, role-based execution gate. | [services/roomManager.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/services/roomManager.js), [modules/websocket-relay](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/modules/websocket-relay/index.js) |
| **CSRF Defense** | NFR-15 | Double-submit cookie with `X-CSRF-Token` header check and `SameSite=Strict` protection. | [middleware/csrf.js](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/middleware/csrf.js) |
| **Architecture** | NFR-48 | Clean separation into 6 independent modules (`auth`, `rooms`, `execution`, `voice`, `relay`, `infra`). | [modules/](file:///c:/Users/maazt/Documents/Collab-IDE/collab-ide/modules/) |
