# CollabIDE — Test Suite & Execution Log

This document lists all test cases designed to verify the functional and non-functional requirements of the CollabIDE backend (Authentication, Room Management, WebSocket Sync, Code Execution, and Voice Signalling).

**Last Execution Date:** July 2026  
**Environment:** Local Integration Environment  
**Database:** MongoDB Atlas (Cloud Cluster0)  
**Status Summary:** 25 / 25 Test Cases Passing (100% Pass Rate)

---

## Test Cases & Execution Details

### TC-AUTH-01 — User Registration Complexity Validation
* **Description:** Verify that a new user registration succeeds only if it satisfies password complexity requirements (minimum 8 characters, at least one uppercase, one lowercase, one number, and one special character) and that passwords are encrypted using bcrypt.
* **Prerequisites:** MongoDB connection is active; email address is not registered.
* **Input Data:** 
  * `email`: `test-owner@collabide.com`
  * `password`: `Password123!` (valid complexity)
  * `displayName`: `Alice Owner`
* **Execution Steps:**
  1. Submit a `POST /api/auth/register` request with input data.
  2. Verify that the response returns HTTP 201.
  3. Verify that the password field in the database is not stored in plaintext and starts with the `$2b$` bcrypt indicator.
* **Expected Result:** Registration returns HTTP 201 with success message; verification link is generated and printed to console; password is fully hashed.
* **Actual Result:** HTTP 201 returned; verification token generated; password stored as a secure bcrypt hash in Atlas DB.
* **Status:** ✅ **PASS**

---

### TC-AUTH-02 — Email Verification Mock Flow
* **Description:** Verify that an unverified user cannot log in and that accessing the verification link manually activates the user account.
* **Prerequisites:** User registration completed in `TC-AUTH-01`.
* **Input Data:** User verification token from registration logs.
* **Execution Steps:**
  1. Attempt login before verification and confirm block.
  2. Call `GET /api/auth/verify-mock?email=test-owner@collabide.com` (or hit the verify link).
  3. Confirm that the user's `isVerified` flag is updated to `true` in MongoDB.
* **Expected Result:** First login attempt blocked; manually hitting the endpoint updates `isVerified` to true.
* **Actual Result:** Login blocked with 403; hitting verify-mock returned success and updated `isVerified` to true in MongoDB.
* **Status:** ✅ **PASS**

---

### TC-AUTH-03 — User Login & Token Split Model
* **Description:** Verify that logging in with valid credentials issues a short-lived access JWT and sets a secure HttpOnly cookie containing the refresh token.
* **Prerequisites:** Email verified in `TC-AUTH-02`.
* **Input Data:** Hashed credentials for `test-owner@collabide.com`.
* **Execution Steps:**
  1. Submit `POST /api/auth/login` with credentials.
  2. Verify that the response returns an access token and user metadata.
  3. Verify that the HTTP response headers set a `refreshToken` cookie.
* **Expected Result:** HTTP 200 returned; access token retrieved; cookie contains the rotated refresh token family details.
* **Actual Result:** HTTP 200 returned; JWT access token verified; cookie set to `refreshToken` with HttpOnly and Strict options.
* **Status:** ✅ **PASS**

---

### TC-ROOM-01 — Room Creation & Ownership Assignment
* **Description:** Verify that an authenticated user can create a room, generating a unique UUID v4 and assigning the creator as the "Owner".
* **Prerequisites:** Owner logged in (`TC-AUTH-03`).
* **Input Data:** `name`: `Test Room Integration`.
* **Execution Steps:**
  1. Submit `POST /api/rooms` with the Owner's JWT Bearer token.
  2. Verify that a unique UUID v4 room path is generated.
  3. Check that the creator is added as `Owner` in the participants array.
* **Expected Result:** Room document created in DB with UUID; participants array lists Alice Owner as "Owner".
* **Actual Result:** Room created with UUID `b8b65e5e-23fa-...`; Alice assigned Owner role.
* **Status:** ✅ **PASS**

---

### TC-ROOM-02 — Room Joining & Default Role Allocation
* **Description:** Verify that a collaborator joining a room via link is added with the read-only "Viewer" role by default.
* **Prerequisites:** Room created in `TC-ROOM-01`; Viewer account registered and verified.
* **Input Data:** Room UUID.
* **Execution Steps:**
  1. Submit `POST /api/rooms/:uuid/join` with Viewer's JWT.
  2. Verify that the user is added to the participants list.
  3. Verify that the default role is set to `'Viewer'`.
* **Expected Result:** Participant added successfully; role returned is `'Viewer'`.
* **Actual Result:** Joined successfully; role recorded in DB and response is `'Viewer'`.
* **Status:** ✅ **PASS**

---

### TC-WS-01 — WebSocket Connection Handshake Blocking (No Token)
* **Description:** Verify that the WebSocket server rejects connections during the HTTP upgrade phase if no JWT access token is provided.
* **Prerequisites:** Express server running.
* **Input Data:** Connection URL: `ws://localhost:3000/:uuid` (without token parameter).
* **Execution Steps:**
  1. Attempt to connect to the WebSocket endpoint.
  2. Verify that the upgrade request fails and returns HTTP 401.
* **Expected Result:** Connection is rejected before the socket is established.
* **Actual Result:** Upgrade handshake rejected with 401 Unauthorized; connection closed.
* **Status:** ✅ **PASS**

---

### TC-WS-02 — WebSocket Connection Acceptance (Owner with Token)
* **Description:** Verify that a room Owner with a valid access token is allowed to establish a WebSocket connection.
* **Prerequisites:** Owner access token; Room UUID.
* **Input Data:** Connection URL: `ws://localhost:3000/:uuid?token=<owner_access_token>`.
* **Execution Steps:**
  1. Attempt to connect to the room WebSocket endpoint using Owner's token.
  2. Verify that the connection upgrades successfully and remains open.
* **Expected Result:** WebSocket upgrades successfully and triggers the `syncStep1` handshake.
* **Actual Result:** WebSocket opened; sync handshake completed successfully.
* **Status:** ✅ **PASS**

---

### TC-WS-03 — WebSocket Connection Acceptance (Viewer with Token)
* **Description:** Verify that a room Viewer with a valid access token is allowed to establish a WebSocket connection.
* **Prerequisites:** Viewer access token; Room UUID.
* **Input Data:** Connection URL: `ws://localhost:3000/:uuid?token=<viewer_access_token>`.
* **Execution Steps:**
  1. Attempt to connect to the room WebSocket endpoint using Viewer's token.
  2. Verify that the connection upgrades successfully.
* **Expected Result:** WebSocket upgrades successfully.
* **Actual Result:** WebSocket connection established.
* **Status:** ✅ **PASS**

---

### TC-WS-04 — WebSocket Write Restriction (Viewer Role Write Blocking)
* **Description:** Verify that binary Yjs sync document updates sent from a client with the "Viewer" role are intercepted and silently dropped by the server.
* **Prerequisites:** WebSocket connections established for Owner and Viewer.
* **Input Data:** Binary Yjs sync message (`syncStep2` / `syncUpdate`).
* **Execution Steps:**
  1. Viewer client sends a binary Yjs update to the WebSocket server.
  2. Observe whether the server relays this update to the Owner client.
  3. Verify that the server does not apply this update to its in-memory document.
* **Expected Result:** Update is silently dropped by the server and never relayed to the Owner.
* **Actual Result:** Update intercepted; server log confirms write dropped; message never relayed to Owner client.
* **Status:** ✅ **PASS**

---

### TC-WS-05 — Live Role Promotion & Write Propagation
* **Description:** Verify that when the Owner promotes a Viewer to "Editor" in real time, the in-memory WebSocket role is updated atomically and subsequent write updates are allowed and relayed.
* **Prerequisites:** WebSocket connections active.
* **Input Data:** `PUT /api/rooms/:uuid/roles` payload: `targetUserId: viewerId, newRole: 'Editor'`.
* **Execution Steps:**
  1. Owner promotes Viewer to Editor via HTTP REST route.
  2. Confirm role is propagated to the WebSocket client object in-memory.
  3. Viewer client sends the binary Yjs update again.
  4. Verify that the Owner client receives the relayed update.
* **Expected Result:** Role updates in-memory; sync update is accepted, applied to server `ydoc`, and relayed to Owner.
* **Actual Result:** Role updated atomically; subsequent binary writes are successfully parsed and relayed to Owner.
* **Status:** ✅ **PASS**

---

### TC-DB-01 — Debounced Document Persistence
* **Description:** Verify that client document edits do not write immediately to the database, but trigger a debounced save after a 2000ms idle period.
* **Prerequisites:** WebSocket connections active; Viewer promoted to Editor.
* **Input Data:** Document sync update string: `console.log("Persistence Test Succeeds!");\n`.
* **Execution Steps:**
  1. Send Yjs sync update message from Editor client.
  2. Wait 4000ms (threshold is 2000ms).
  3. Query the Room document directly from MongoDB and check file content.
* **Expected Result:** File content in database is updated with the changes after the debouncing period.
* **Actual Result:** Database successfully updated; `main.js` content matches the typing buffer updates after a 2000ms delay.
* **Status:** ✅ **PASS**

---

## Code Execution Module Tests (FR-27 – FR-33, NFR-35, NFR-43)

> Execution tested in **mock mode** (`EXECUTION_MOCK_MODE=true`). All API surfaces are identical to real mode — mock mode returns realistic responses without calling Judge0. Swap `EXECUTION_MOCK_MODE=false` and provide `JUDGE0_API_KEY` for live execution.

---

### TC-EXEC-01 — Viewer Role Cannot Execute Code
* **Description:** Verify that a room participant with the `Viewer` role cannot trigger code execution and receives an HTTP 403 Forbidden response.
* **Prerequisites:** Room created; fresh `Viewer` account joined.
* **Input Data:** `POST /api/execution/:uuid/run` with Viewer's JWT; `{ code: 'print("hello")', language: 'python' }`.
* **Execution Steps:**
  1. Register and verify a new Viewer user `Carol Viewer`.
  2. Viewer joins the room (defaults to Viewer role).
  3. Viewer calls the execution endpoint.
* **Expected Result:** HTTP 403 returned with message about Viewer role restriction.
* **Actual Result:** HTTP 403 returned: `"Viewers cannot execute code. Ask the Room Leader to promote you to Editor."`
* **Status:** ✅ **PASS**

---

### TC-EXEC-02 — Owner Runs Code and Receives Result
* **Description:** Verify that a room Owner can call the execution endpoint and receive a structured result payload (stdout, stderr, status, time, memory).
* **Prerequisites:** Owner logged in; room created.
* **Input Data:** `{ code: 'print("Hello from Python!")', language: 'python' }`.
* **Execution Steps:**
  1. Owner calls `POST /api/execution/:uuid/run`.
  2. Verify HTTP 200 returned.
  3. Verify result payload contains `stdout`, `status`, `language`, `triggeredBy`, `isMock`.
* **Expected Result:** HTTP 200 with `result.status === "Accepted"` and non-empty `stdout`.
* **Actual Result:** HTTP 200; `status: "Accepted"`, `stdout: "Hello from Python!\n"`, `isMock: true`.
* **Status:** ✅ **PASS**

---

### TC-EXEC-03 — Execution Result Broadcast to All Room WebSocket Clients
* **Description:** Verify that when any Editor/Owner triggers execution, the `exec:result` message is broadcast as a JSON text frame to every open WebSocket connection in the room (FR-29).
* **Prerequisites:** Owner and a Viewer have active WebSocket connections in the same room.
* **Input Data:** Owner calls execution endpoint; both WS clients listen for `type: "exec:result"` frames.
* **Execution Steps:**
  1. Open two WebSocket connections (Owner + Viewer).
  2. Owner calls `POST /api/execution/:uuid/run`.
  3. Wait 1000ms.
  4. Check that both WebSocket clients received a message with `type: "exec:result"`.
* **Expected Result:** Both connections receive the `exec:result` text frame.
* **Actual Result:** Both Owner WS and Viewer WS received `exec:result` frame within 1000ms.
* **Status:** ✅ **PASS** (TC-EXEC-03a Owner ✅ | TC-EXEC-03b Viewer ✅)

---

### TC-EXEC-04 — Unsupported Language Rejected (HTTP 400)
* **Description:** Verify that requesting execution with an unsupported language identifier (e.g., `"sql"`) returns HTTP 400 Bad Request with a clear error message.
* **Prerequisites:** Owner logged in.
* **Input Data:** `{ code: 'SELECT 1', language: 'sql' }`.
* **Execution Steps:**
  1. Owner calls `POST /api/execution/:uuid/run` with `language: "sql"`.
  2. Verify HTTP 400 returned.
* **Expected Result:** HTTP 400 with message listing supported languages.
* **Actual Result:** HTTP 400 returned with: `"Unsupported language \"sql\". Supported: javascript, python, cpp, c, java."`
* **Status:** ✅ **PASS**

---

### TC-EXEC-05 — Execution with Stdin Input (FR-31)
* **Description:** Verify that the execution endpoint accepts an optional `stdin` field and passes it to the execution sandbox.
* **Prerequisites:** Owner logged in.
* **Input Data:** `{ code: 'name = input()\nprint(f"Hello, {name}!")', language: 'python', stdin: 'CollabIDE' }`.
* **Execution Steps:**
  1. Owner calls execution endpoint with the `stdin` field populated.
  2. Verify HTTP 200 returned.
  3. Verify `result.status` is `"Accepted"`.
* **Expected Result:** Execution succeeds; stdin is accepted and forwarded.
* **Actual Result:** HTTP 200 returned; `status: "Accepted"`, `isMock: true`.
* **Status:** ✅ **PASS**

---

### TC-EXEC-06 — Timeout Simulation Surfaces Correct Status (FR-30)
* **Description:** Verify that code triggering a timeout (infinite loop) results in a response with `status: "Time Limit Exceeded"` rather than a server error.
* **Prerequisites:** Mock mode active (mock detects `while True: pass` pattern).
* **Input Data:** `{ code: 'while True: pass', language: 'python' }`.
* **Execution Steps:**
  1. Owner calls execution endpoint with infinite-loop code.
  2. Verify HTTP 200 returned (execution service always returns 200; timeout is in the result payload).
  3. Verify `result.status` contains `"Time Limit Exceeded"`.
* **Expected Result:** HTTP 200; `result.status === "Time Limit Exceeded"`.
* **Actual Result:** HTTP 200; `result.status: "Time Limit Exceeded"`.
* **Status:** ✅ **PASS**

---

### TC-EXEC-07 — Execution History Endpoint Returns Persisted Results (FR-35)
* **Description:** Verify that `GET /api/execution/:uuid/history` returns the array of persisted execution results for the room, enabling late-joining participants to hydrate their output panel.
* **Prerequisites:** At least 3 execution runs previously completed in the room (from TC-EXEC-02, TC-EXEC-03, TC-EXEC-05, TC-EXEC-06).
* **Input Data:** Owner JWT.
* **Execution Steps:**
  1. Call `GET /api/execution/:uuid/history` with Owner's Bearer token.
  2. Verify HTTP 200 returned.
  3. Verify response contains `history` array with ≥ 3 entries.
* **Expected Result:** HTTP 200; `history` array is populated with prior run results including language, status, stdout, and timestamps.
* **Actual Result:** HTTP 200; history array returned with 5 entries from prior runs.
* **Status:** ✅ **PASS**

---

## WebRTC Voice Signalling Module Tests (FR-45 – FR-53, NFR-29 – NFR-31)

> All signalling is coordinated using **Socket.IO over the `/voice` namespace** sharing the existing port. ICE servers (STUN + TURN) are dynamically issued with **time-limited HMAC credentials** (expiry 1 hour) based on coturn REST API specification.

---

### TC-VOICE-01 — Socket.IO Authentication Rejects Sockets Without JWT (NFR-17)
* **Description:** Verify that connections to the `/voice` Socket.IO namespace without presenting a valid JWT token in handshake authentication are immediately rejected.
* **Prerequisites:** Socket.IO server running.
* **Input Data:** Empty or invalid handshake auth payload.
* **Execution Steps:**
  1. Attempt to connect to `/voice` namespace with `token: ""`.
  2. Verify that `connect_error` is triggered.
  3. Verify error message is `'AUTH_REQUIRED'` or `'AUTH_FAILED'`.
* **Expected Result:** Socket.IO connection is rejected.
* **Actual Result:** Socket.IO rejected connection with error `'AUTH_REQUIRED'`.
* **Status:** ✅ **PASS**

---

### TC-VOICE-02 — Client Joins Voice Channel & Hydrates State (FR-45)
* **Description:** Verify that a valid room Editor or Owner can join the room's voice channel, trigger a broadcast update to peers, and that the REST participants list matches the active channel membership.
* **Prerequisites:** Room created; Owner logged in.
* **Input Data:** Owner JWT; room UUID.
* **Execution Steps:**
  1. Connect to `/voice` with Owner JWT.
  2. Emit `voice:join` with `{ roomUuid }`.
  3. Verify that `voice:participant-joined` is broadcast to the room containing Owner's profile.
  4. Query the HTTP GET `/api/voice/:uuid/participants` endpoint and check length.
* **Expected Result:** Connection accepted; join event broadcast; REST API returns 1 active participant.
* **Actual Result:** Owner joined voice (socket registered); `voice:participant-joined` received; REST endpoint returned 1 active participant.
* **Status:** ✅ **PASS** (TC-VOICE-02a Join ✅ | TC-VOICE-02b REST ✅)

---

### TC-VOICE-03 — WebRTC SDP Offer / Answer Relay (FR-53)
* **Description:** Verify that WebRTC signalling SDP offers/answers are forwarded correctly from a peer to a target peer socket ID (NFR-31 compliant text-only relay).
* **Prerequisites:** Owner and Editor connected to the voice channel in the same room.
* **Input Data:** SDP payload: `{ to: ownerSocketId, sdp: { type: 'offer', sdp: 'v=0...' } }`.
* **Execution Steps:**
  1. Editor emits `voice:offer` targeted to Owner socket.
  2. Verify that Owner socket receives `voice:offer` event with exact SDP.
* **Expected Result:** SDP offer relayed to target without server manipulation.
* **Actual Result:** SDP offer delivered successfully to Owner socket containing Bob's candidate details.
* **Status:** ✅ **PASS**

---

### TC-VOICE-04 — WebRTC ICE Candidate Relay (FR-53)
* **Description:** Verify that WebRTC ICE network candidate payloads are forwarded correctly to the specified peer.
* **Prerequisites:** Owner and Editor connected.
* **Input Data:** Candidate payload: `{ to: bobSocketId, candidate: { candidate: 'candidate:1...' } }`.
* **Execution Steps:**
  1. Owner emits `voice:ice-candidate` targeted to Bob.
  2. Verify that Bob socket receives `voice:ice-candidate` event.
* **Expected Result:** ICE candidate relayed to target peer.
* **Actual Result:** ICE candidate received successfully on Bob's socket.
* **Status:** ✅ **PASS**

---

### TC-VOICE-05 — Self Mute State Broadcast (FR-47)
* **Description:** Verify that when a participant mutes themselves, the state update is broadcast immediately to all other participants.
* **Prerequisites:** Owner and Editor connected.
* **Input Data:** `{ isMuted: true }`.
* **Execution Steps:**
  1. Editor emits `voice:mute-self` with `isMuted: true`.
  2. Verify that Owner receives `voice:mute-changed` event with Editor's userId and `isMuted: true`.
* **Expected Result:** Mute change broadcast to room.
* **Actual Result:** Mute changed event received on Owner client: `isMuted: true`, `userId: Bob Viewer ID`.
* **Status:** ✅ **PASS**

---

### TC-VOICE-06 — Room Leader Hard Mute & Self-Unmute Block (FR-48, FR-49)
* **Description:** Verify that the Room Leader (Owner) can hard mute another participant, sending a private notification and preventing them from unmuting themselves.
* **Prerequisites:** Owner and Editor connected; Editor is not muted.
* **Input Data:** `{ targetSocketId: bobSocketId, hard: true }` sent by Owner.
* **Execution Steps:**
  1. Owner emits `voice:mute-participant` targeting Bob with `hard: true`.
  2. Verify Bob receives `voice:muted-by-leader` message: `"You were hard-muted by Alice Owner"`.
  3. Bob emits `voice:mute-self` with `isMuted: false` to try to unmute.
  4. Verify that Bob receives `voice:error` event: `"You have been hard-muted by the Room Leader. You cannot unmute yourself."`.
* **Expected Result:** Target receives leader mute notification; server rejects target self-unmute request.
* **Actual Result:** Target received hard-mute payload; server blocked unmute attempt returning the correct hard-mute message.
* **Status:** ✅ **PASS** (TC-VOICE-06a Mute Notification ✅ | TC-VOICE-06b Unmute Block ✅)

---

### TC-VOICE-07 — Dynamic HMAC-Signed time-limited TURN Credentials (NFR-30)
* **Description:** Verify that GET `/api/voice/:uuid/credentials` generates coturn-compatible time-limited HMAC credentials unique to the user, with 1-hour expiry.
* **Prerequisites:** Room member logged in.
* **Input Data:** Room member JWT.
* **Execution Steps:**
  1. Send GET request to `/api/voice/:uuid/credentials`.
  2. Verify response includes `iceServers` array.
  3. Verify `credentials` object contains `username` (format `<expiry>:<userId>`) and `credential` (base64 HMAC).
  4. Verify `expiresAt` is exactly 3600 seconds in the future.
* **Expected Result:** HTTP 200 containing valid username, credentials, and future expiry timestamp.
* **Actual Result:** HTTP 200 returned; `username` format holds correct epoch Unix timestamp; base64 HMAC matches secret key signatures.
* **Status:** ✅ **PASS**

