# Requirements Traceability Matrix (RTM)

| Version | Date | Author (Softex Agent ID) | Description of Changes | Status |
| :--- | :--- | :--- | :--- | :--- |
| v1.0 | 2026-07-28 | `requirements_analyst` | Initial traceability matrix generated from CollabIDE SRS. | Approved |

## 1. Introduction (ISO/IEC/IEEE 29148 Requirements Engineering)
This document provides bidirectional traceability between the CollabIDE Software Requirements Specification (SRS) and the current system implementation to verify coverage and identify gaps.

## 2. Traceability Matrix

| Requirement ID | Description | Priority | Implementation Status | Technical Component / Location |
| :--- | :--- | :--- | :--- | :--- |
| **FR-01 to FR-06** | Authentication, JWT, Refresh Tokens, Logout | High | Implemented | `routes/auth.js`, `AuthView.jsx` |
| **FR-10 to FR-13** | Room Creation, Joining, Persistence, Roles | High | Implemented | `routes/rooms.js`, `Room` model |
| **FR-16 to FR-20** | CRDT Sync, Cursors, Disconnect Handling | High | Implemented | `y-websocket`, `WorkspaceView.jsx` |
| **FR-21** | Multi-File Support | Medium | **Pending** | N/A |
| **FR-27 to FR-30** | Judge0 Code Execution & Broadcasting | High | Implemented | `routes/execution.js`, `render.yaml` |
| **FR-34 to FR-36** | In-Room Chat & History Persistence | Medium | Partial (No history) | `WorkspaceView.jsx` |
| **FR-39 to FR-44** | Room Leader Live Access Controls | High | Implemented | WebSocket relay, `WorkspaceView.jsx` |
| **FR-45 to FR-53** | WebRTC Voice Chat & Signalling | High | Implemented | `socket/voice.js`, `WorkspaceView.jsx` |
| **FR-54 to FR-57** | File Management (Create, Rename, Delete) | Medium | **Pending** | N/A |
| **NFR-18** | Server-Side Role Enforcement | High | Implemented | WebSocket interception |
| **NFR-27** | Secrets Management | High | Implemented | `render.yaml` environment injection |
