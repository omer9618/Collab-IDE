# CollabIDE — FYP Proof of Concept

Real-time collaborative code editor using Monaco Editor + Yjs CRDT + WebSockets.

## Quick start (2 minutes)

```bash
npm install
node server.js
```

Then open **http://localhost:3000** in two browser tabs.

- Enter different names in each tab
- Use the same Room ID (default: `demo-room`)
- Click Join — start typing in one tab and watch it sync instantly in the other

## What this demo proves to your supervisor

1. **Real-time CRDT sync** — Yjs handles conflict-free simultaneous editing
2. **Live cursor presence** — each user's avatar appears in the header
3. **Multi-file support** — switch between main.js, utils.js, README.md
4. **In-room chat** — click the Chat tab
5. **Code execution** — click ▶ Run (JS runs in browser sandbox for demo)

## Stack

| Layer | Technology |
|---|---|
| Editor | Monaco Editor (VS Code engine) |
| Real-time sync | Yjs (CRDT) + y-websocket |
| Editor binding | y-monaco |
| Server | Node.js + Express + ws |
| Execution (demo) | Browser sandbox (production: Judge0) |

## For production FYP

- Replace browser `new Function()` execution with Judge0 API calls
- Add MongoDB for user auth and room persistence  
- Add JWT middleware to protect room access
- Deploy server to Railway or Render (free tier)
