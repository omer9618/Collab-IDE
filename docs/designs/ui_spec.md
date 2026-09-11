# CollabIDE — UI/UX Design Specification v1.0
**For:** React + Vite frontend implementation
**Prepared for:** Antigravity (implementation) / Omer (review)
**Based on:** Stitch generated screens + requirements SRS v1.2 + frontend-design skill + ui-ux-pro-max guidelines
**Date:** July 2026

---

## 0. What this document is

This is the authoritative design specification for the CollabIDE frontend. It supersedes the Stitch-generated screens where they conflict with the actual backend capabilities. Every component, state, and interaction described here maps directly to a verified backend endpoint or WebSocket event from the completed backend.

**What to keep from Stitch:** Color token system, Inter + JetBrains Mono font pairing, three-column layout structure, 48px activity bar, 4px scrollbar width, glass panel pattern for floating UI, `cubic-bezier(0.4, 0, 0.2, 1)` transitions.

**What to discard from Stitch:** All video feed UI (backend is audio-only), camera/screen-share buttons, Source Control and Extensions activity bar icons, "Initialize Project" / "Browse Templates" buttons, stock photo avatars, persistent User Profile panel, "Welcome back, Developer" copy, "v2.4.1" footer on login.

---

## 1. Design Token System

Keep the Stitch token system exactly. Reference these as CSS custom properties.

### Dark theme (default)
```
--bg-base:          #0d0e0f   (deepest — activity bar, sidebar base)
--bg-surface:       #121414   (page background)
--bg-panel:         #1b1c1c   (sidebar, file tree, right panel)
--bg-elevated:      #1f2020   (cards, inputs, hover targets)
--bg-hover:         #252626   (hover state on list items)
--bg-active:        #292a2a   (selected file, active tab)
--border-subtle:    #2b2b2b   (panel dividers)
--border-default:   #404751   (input borders, card outlines)
--border-strong:    #8a919d   (focused inputs, active indicators)
--text-primary:     #e3e2e2   (main text)
--text-secondary:   #c0c7d3   (secondary labels, file names)
--text-muted:       #8a919d   (timestamps, line numbers, placeholders)
--accent-blue:      #007acc   (primary action, active tab indicator, focus ring)
--accent-blue-dim:  #9fcaff   (primary text on dark, softer accent)
--accent-green:     #1e8e3e   (speaking indicator, success states)
--accent-red:       #d93025   (muted mic, error states, destructive actions)
--accent-orange:    #b95e01   (warning states, tertiary highlights)
--status-success:   #4caf50   (terminal stdout)
--status-error:     #f44336   (terminal stderr)
--status-warning:   #ffc107   (terminal warnings)
```

### Light theme
```
--bg-base:          #e8e9ea
--bg-surface:       #f1f3f4
--bg-panel:         #ffffff
--bg-elevated:      #f8f9fa
--bg-hover:         #e8eaed
--bg-active:        #e1e3e6
--border-subtle:    #e0e0e0
--border-default:   #c4c7cf
--border-strong:    #44474e
--text-primary:     #202124
--text-secondary:   #44474e
--text-muted:       #5f6368
--accent-blue:      #1a73e8
--accent-blue-dim:  #0061a4
--accent-green:     #1e8e3e
--accent-red:       #d93025
--accent-orange:    #e37400
```

### Typography
```
UI font:    Inter (weights: 400, 500, 600)
Code font:  JetBrains Mono (weights: 400, 500)

Scale:
--text-xs:    11px / 16px  / Inter 500   (labels, badges, timestamps)
--text-sm:    13px / 18px  / Inter 400   (body, file names, chat)
--text-base:  14px / 20px  / Inter 500   (headers, tab labels)
--text-lg:    16px / 24px  / Inter 600   (section titles)
--text-xl:    20px / 28px  / Inter 600   (page headings)
--text-2xl:   28px / 36px  / Inter 600   (hero text — login only)
--code-sm:    12px / 18px  / JetBrains Mono 400  (terminal output)
--code-base:  14px / 21px  / JetBrains Mono 400  (editor)
```

### Peer presence colors
Reserved exclusively for collaborative cursor carets, avatar borders, and name labels. Never reuse for UI chrome.
```
Peer 1: #1a73e8  (blue)
Peer 2: #1e8e3e  (green)
Peer 3: #f9ab00  (amber)
Peer 4: #a142f4  (purple)
Peer 5: #e52592  (pink)
```

### Spacing and shape
```
Base unit: 4px
Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48px

Border radius:
  --radius-sm:   2px   (pills inside the editor, cursor labels)
  --radius-md:   4px   (buttons, inputs, tabs, file rows)
  --radius-lg:   8px   (cards, panels, modals)
  --radius-full: 9999px (avatar circles, the voice dock)

Fixed dimensions:
  Activity bar width:  48px
  Sidebar width:       240px (collapsible)
  Right panel width:   280px (collapsible)
  Top bar height:      44px
  Status bar height:   22px
  Voice dock height:   64px (floating, centered bottom)
  Bottom console min:  160px (resizable, drag handle)
```

### Motion
```
All transitions: cubic-bezier(0.4, 0, 0.2, 1)
Micro-interactions: 150ms
Panel open/close:   250ms
Toast slide-in:     200ms
Speaking pulse:     scale(1.0) → scale(1.04), 2s infinite ease-in-out
```

---

## 2. Global Shell Architecture

Every authenticated page after login uses this shell. The shell is a fixed full-viewport flex layout — no page scroll.

```
┌─────────────────────────────────────────────────────────────────┐
│  TOP BAR (44px fixed)                                           │
├──┬──────────────┬───────────────────────────────┬──────────────┤
│AB│  SIDEBAR     │  MAIN AREA (flex-grow)         │  RIGHT PANEL │
│48│  240px       │                               │  280px       │
│px│  collapsible │                               │  collapsible │
│  │              │                               │              │
│  │              │                               │              │
├──┴──────────────┴───────────────────────────────┴──────────────┤
│  STATUS BAR (22px fixed)                                        │
└─────────────────────────────────────────────────────────────────┘
         [VOICE DOCK — floating, centered, above status bar]
```

**Activity Bar (AB):** 48px fixed left. Icon-only. Only icons that map to real features.
**Sidebar:** Collapsible via activity bar icon click. Default open.
**Main Area:** Flex-grows to fill remaining space. Contains editor + bottom console panel.
**Right Panel:** Collapsible. Contains participants roster + chat tabs.
**Status Bar:** 22px fixed bottom. Accent blue background (#007acc in dark, #1a73e8 in light). Shows sync status, user count, active language, room ID.
**Voice Dock:** Floating pill, centered horizontally, sits 12px above the status bar. Only visible when in a room.

---

## 3. Screen 1 — Login / Register

### Layout
Two-column split at 1280px minimum. Left 55%, right 45%.

**Left side — brand panel:**
- Dark background (#0d0e0f), not white/gray
- Large headline: "Code together, in real time." — Inter 600, 36px, text-primary
- Subheading: "A collaborative IDE with live editing, voice chat, and instant code execution." — Inter 400, 16px, text-secondary
- Below: Three feature callouts in a vertical list, each with a small icon and one-line description:
  - ⚡ Real-time sync — "CRDT-based editing. No conflicts, ever."
  - 🎙 Voice chat �� "Audio-first collaboration built into the room."
  - ▶ Code execution — "Run code in 5 languages, output shared instantly."
- Bottom-left: Small text in text-muted: "Bahria University FYP · BSE 2026"

**Right side — auth card:**
- Card sits centered vertically, width 380px, bg-elevated, border-default, radius-lg
- Logo + app name at top (placeholder mark + "CollabIDE" in accent-blue, Inter 600 20px)
- Tab switcher: "Sign in" | "Create account" — two tabs, active tab has accent-blue bottom border
- No "Continue with Google/GitHub" — backend does not support OAuth, do not fake it

**Sign in tab fields:**
```
Email               [text input, full width]
Password            [password input with show/hide toggle]
                    Forgot password? [link, right-aligned, text-xs]
[Sign in →]         [primary button, full width, accent-blue bg]
```

**Create account tab fields:**
```
Display name        [text input]
Email               [text input]
Password            [password input, show/hide toggle]
                    Min 8 chars, 1 uppercase, 1 number, 1 special char
                    [strength indicator bar — 4 segments, fills left to right]
[Create account →]  [primary button, full width]
```

**After register:** Show inline success state — green checkmark, "Check your email to verify your account. The link expires in 24 hours." Do not redirect until verified.

**Validation states:**
- Real-time validation on blur (not on keystroke)
- Error: input border turns accent-red, error message appears below in text-xs accent-red
- No toast for form validation errors — inline only
- Loading state on submit: button shows spinner, disabled

**No footer links. No version number.**

---

## 4. Screen 2 — Room Dashboard

### Layout
Uses the global shell. Sidebar shows nav items. Main area shows dashboard content. Right panel is closed by default on dashboard.

**Activity bar icons (dashboard):**
```
Top:
  [folder]   — File explorer / rooms list (active on dashboard)
  [people]   — Participants (disabled on dashboard, enabled in room)
  [chat]     — Chat (disabled on dashboard, enabled in room)

Bottom:
  [settings] — User settings
  [logout]   — Sign out (with confirmation)
```

**Sidebar (dashboard):**
```
┌────────────────────────────┐
│ [Avatar] Display Name      │
│ your@email.com   [Owner]   │
├────────────────────────────┤
│ ROOMS                      │
│ ○ My Rooms                 │
│ ○ Joined Rooms             │
├────────────────────────────┤
│ [+ Create new room]        │
└────────────────────────────┘
```
Avatar is a colored circle with user's initials — no photo. Color matches the user's assigned peer color from their profile. Role badge shown inline in text-xs, bg-elevated, border-default.

**Main area — dashboard:**

Section header row:
```
My Rooms                          [+ New room]
```

Room cards — use a list layout, not a grid:
```
┌──────────────────────────────────────────────────────┐
│ [JS] room-name-here          Owner · 2h ago          │
│      3 files · main.js, utils.js, +1                 │
│      [Omer] [Hamza]  +2 more                [Open →] │
└──────────────────────────────────────────────────────┘
```

Language badge: small colored square with language abbreviation (JS=yellow, PY=blue, CPP=purple, JAVA=orange). No file type icons from VS Code — use simple colored text badges.

Participant avatars: stacked colored initial circles (max 3 shown, then "+N more"). No photos.

Last active: relative time ("2 hours ago", "Yesterday", "5 days ago").

Empty state — no rooms yet:
```
        [folder icon, 48px, text-muted]
        No rooms yet
        Create a room to start collaborating with your team.
        [Create your first room →]
```

**Quick join row** — below room list, separated by a divider:
```
──── or join with a room code ────
[Enter room code...] [Join →]
```

**Create room modal** — triggered by "+ New room" or "+ Create your first room":
```
Create a new room
─────────────────────────────────
Room name        [text input]
                 Letters, numbers, hyphens only

[Cancel]                [Create room →]
```
On success: navigate directly into the room. No "Browse Templates", no "Initialize Project".

**User settings** — opens as a right-side drawer (not a full page), triggered from activity bar settings icon:
```
Settings
─────────────────────────────
APPEARANCE
Theme           [Dark ▾] [Light]  (toggle)
Font size       [14px ▾]

ACCOUNT
Display name    [editable field]
Email           your@email.com (read-only)
                [Change password →]

SESSIONS
Active sessions (3)
  Chrome · Windows · Now          [Revoke]
  Firefox · Windows · 2h ago      [Revoke]
  [Revoke all other sessions]

DANGER
[Delete account]
```

---

## 5. Screen 3 — Editor Workspace (Editor / Owner / Room Leader)

This is the primary screen. Most time is spent here.

### Top bar (44px)
```
[Logo]  [room-name]  [Main.js] [utils.js] [●App.tsx ×]      [Run ▶] [lang ▾] [N users] [avatar]
```

- Logo: small mark + "CollabIDE" text, clicking goes to dashboard
- Room name: text-secondary, text-sm. Clicking copies invite link (brief "Copied!" tooltip)
- File tabs: active tab has top 2px accent-blue border, no bottom border, close icon on hover only. Unsaved indicator: small dot before filename (● App.tsx)
- Run button: accent-blue bg, white text, play icon. Shows spinner while executing. Disabled if Viewer role.
- Language dropdown: shows active file language. Changing it updates Monaco syntax highlighting.
- N users badge: shows count of connected users e.g. "3 online". Clicking opens right panel to participants tab.
- Avatar: initials circle. Clicking opens settings drawer.
- NO camera button. NO screen share button. NO debug button (out of scope for FYP).

### Activity bar (48px, left)
```
Top:
  [folder]   — Toggle sidebar / file tree       (active = accent-blue left border)
  [people]   — Toggle right panel / participants
  [chat]     — Toggle right panel / chat

Bottom:
  [settings] — Settings drawer
  [door-exit]— Leave room (with confirm dialog)
```

Only these five icons. No Search, Source Control, Extensions.

### Sidebar (240px) — File tree
```
┌───────────���──────────────────────┐
│ EXPLORER           [+ file] [⋯] │
│ room-name · Owner               │
├──────────────────────────────────┤
│ ▾ src/                          │
│   ▾ components/                 │
│     ○ Button.jsx                │
│   ● index.js        ← active   │
│   ○ utils.js                    │
│ ○ package.json                  │
└──────────────────────────────────┘
```

File row states:
- Default: text-secondary, no bg
- Hover: bg-hover, show micro-action icons on right ([rename] [delete]) — only if Editor/Owner role, hidden for Viewers
- Active: bg-active, accent-blue left border, text-primary
- Active cursor from another user: small colored dot before filename matching their peer color

File icons: language-colored dots, not Material symbols. JS=yellow dot, TS=blue dot, CSS=purple dot, JSON=gray dot, MD=gray dot. Keep it minimal.

Bottom of sidebar: "Share invite link" button — text style, accent-blue, copies room URL.

### Main editor area

**Monaco editor:** fills all available space. No padding around it. Line numbers in text-muted. Standard vs-dark theme in dark mode, vs-light in light mode.

**Collaborative cursor carets:**
- 2px vertical line in peer color
- Name label floats 2px above caret: small pill, bg=peer color, text=white, Inter 500 10px, radius-sm
- Selection highlight: peer color at 20% opacity

**"N editing" indicator:** Small pill floating bottom-right of editor canvas, 12px above the bottom console divider. bg=glass-panel (rgba(31,32,32,0.75) + blur 8px), text-secondary, radius-full. Shows stacked peer color dots + "2 editing". Subtle, not intrusive.

**Bottom console panel:**
- Drag handle at top (4px strip, bg-border-subtle, cursor:row-resize)
- Min height 120px, default 200px, max 50% of viewport
- Tab strip: [Terminal] [Output] [Problems]
- Collapse button (chevron-down) top-right of tab strip
- Terminal tab: stdin input at bottom, stdout/stderr log above. stdout in text-primary, stderr in accent-red, system messages in text-muted. JetBrains Mono code-sm.
- Output tab: shows execution results from Run button. Includes exit code, execution time in ms, memory used.
- Problems tab: placeholder for future linting (show "No problems detected" empty state)

### Right panel (280px) — Participants + Chat

**Two tabs at top of panel:** [Participants (3)] [Chat]

**Participants tab:**

Panel header row (below tabs):
```
Participants · 3 online
[Room Leader controls — only visible to Owner/Room Leader]
  [Grant all ▾]  [Revoke all]  [Mute all]
```

Participant row:
```
┌─────────────────────────────────────┐
│ [●] [H] Hamza          [Editor]    │
│          Speaking...    [⋯]         │
└─────────────────────────────────────┘
```

- Colored initial circle (peer color assigned on join)
- Online dot: filled green circle overlay on avatar bottom-right
- Display name: text-primary, text-sm
- Role badge: text-xs, radius-sm
  - Owner: bg gold-tinted (#3d3000), text (#f9ab00)
  - Room Leader: bg blue-tinted (#001a3d), text (#9fcaff)
  - Editor: bg green-tinted (#0a2510), text (#34a853)
  - Viewer: bg-elevated, text-muted, border-default
- Speaking indicator: "Speaking..." text in accent-green, text-xs. Replaced by "Muted" in text-muted when muted.
- Speaking animation: subtle green ring pulse on avatar when speaking (scale 1.0→1.04, 2s infinite)
- Hard muted: avatar has red overlay at 20% opacity, mic icon with slash shown next to name
- [⋯] menu: only visible to Owner/Room Leader on hover. Options:
  - Grant access (if Viewer)
  - Revoke access (if Editor)
  - Mute / Hard mute (if in voice)
  - Release hard mute (if hard muted)

"You" row: always shows at bottom with "(You)" suffix, no [⋯] menu.

**Chat tab:**

Messages area — scrollable, oldest at top:
```
[H] Hamza             14:32
    yo check line 9, i think thats the issue

[O] Omer              14:33
    yeah ur right fixing now
```

- Avatar: colored initial circle, 24px
- Name + timestamp on same row, text-xs text-muted
- Message bubble: no bubble — just text, text-sm text-primary, left-aligned below avatar row
- Own messages: same left-aligned style, no special bubble color (keep it simple, not iMessage-style)
- System messages (role changes, user joins/leaves): centered, text-xs text-muted, italic. E.g. "Hamza joined the room · 14:31"

Input row at bottom:
```
[Type a message...                      ] [↑]
```
- Input: full width, bg-elevated, border-default, radius-md, 36px height
- Send button: icon only (arrow-up), accent-blue
- Enter key sends, Shift+Enter for newline

### Voice dock (floating)

Centered horizontally, positioned 12px above status bar. Only shown when in a room.

```
    ┌─────────────────────────────────────────┐
    │  [🎙]    [💬]    [👥]         [Leave] │
    └─────────────────────────────────────────┘
```

Pill shape (radius-full). bg=glass-panel. 56px tall. Width auto based on content.

**Mic button states:**
- Unmuted: icon in text-secondary, bg transparent. Click to mute.
- Muted by self: icon with slash overlay, bg accent-red (dark red #4a0000 bg, red icon). Click to unmute.
- Hard muted by leader: same red state, but clicking shows tooltip "Muted by Room Leader" instead of unmuting. Cannot self-unmute.
- Not in voice: mic icon dimmed, clicking joins voice channel.

**Chat shortcut button:** Opens/focuses chat tab in right panel.

**Participants shortcut button:** Opens/focuses participants tab in right panel.

**Leave button:** Red background (#d93025), white text "Leave", telephone-down icon. Clicking shows confirm dialog: "Leave room? You can rejoin anytime with the invite link." [Cancel] [Leave]

**Owner/Room Leader only — additional controls visible in dock:**
```
    ┌──��─────────────────────────────────────────────────────┐
    │  [🎙]  [💬]  [👥]  |  [Grant all] [Revoke all] [Mute all]  [Leave] │
    └────────────────────────────────────────────────────────┘
```
The three admin controls are text buttons (not icon-only) so their function is unambiguous.

### Status bar (22px)

Accent-blue background. White text. Left to right:
```
● Synced    |    3 online    |    JavaScript    |    room-uuid-short    |    UTF-8
```

- Sync dot: green when connected and synced. Yellow + pulsing when reconnecting. Red if disconnected.
- "Synced" changes to "Reconnecting..." or "Offline" based on WebSocket state.
- Room UUID: shortened to first 8 chars. Clicking copies full UUID.

---

## 6. Screen 4 — Viewer Role State

Same layout as Screen 3. Differences only:

### Editor
- Monaco `readOnly: true`
- No cursor caret for "You" — you cannot type
- Other users' carets still visible and animated
- Grey watermark text in bottom-right corner of editor canvas: "VIEW ONLY" — Inter 500, 11px, text-muted, letter-spacing 0.1em

### Top bar
- Run button: replaced by a locked state — same button shape, bg-elevated, text-muted, lock icon, tooltip "Run disabled — Viewer access only"
- File tabs: no close button on any tab (cannot add/remove files)

### Sidebar
- No [+ file] button in explorer header
- No micro-action icons on file hover (no rename/delete)
- File tree is read-browse only

### Voice dock
- Mic button: struck-through icon by default (Viewer = listen-only)
- If Room Leader grants voice speak access: mic becomes interactive
- "VIEW ONLY" tooltip on mic button when locked

### System toast on access change
When the Room Leader grants or revokes access, show a toast:

**Access granted:**
```
┌──────────────────────────────────────────────┐
│ ✓  Edit access granted                       │
│    You can now type in the editor.            │
└──────────────────────────────────────────────┘
```
bg: dark green tint (#0a2510), left border: accent-green, auto-dismiss 4s

**Access revoked:**
```
┌──────────────────────────────────────────────┐
│ ⚠  Edit access removed                      │
│    The Room Leader has set you to view-only. │
└──────────────────────────────────────────────┘
```
bg: dark amber tint (#2d1f00), left border: accent-orange, auto-dismiss 6s (longer because it's a disruptive change)

**Hard muted:**
```
┌──────────────────────────────────────────────┐
│ 🎙  Muted by Room Leader                     │
│    You can't unmute yourself right now.       │
└──────────────────────────────────────────────┘
```
bg: dark red tint (#2d0000), left border: accent-red, auto-dismiss 5s

---

## 7. Toast / Notification System

All toasts slide in from bottom-right. Stack vertically if multiple.

**Structure:**
```
┌─────────────────────────────────────┐ ←─ 3px left border (semantic color)
│ [icon]  Title text                  │
│         Supporting detail text       │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ ←─ auto-dismiss progress bar
└─────────────────────────────────────┘
```

- Width: 320px
- bg: bg-panel, border-default, radius-lg
- Left border: 3px, color matches type (green/amber/red/blue)
- Progress bar: 2px height at very bottom, fills left to right over dismiss duration
- Manual dismiss: [×] icon top-right
- Animation: slide up from bottom + fade in (200ms), slide down + fade out (150ms)

**Types and durations:**
- Success (green, 3s): user joins, file saved, execution complete
- Info (blue, 4s): role assigned, room created
- Warning (amber, 6s): access revoked, approaching rate limit
- Error (red, persistent until dismissed): connection lost, execution failed, auth error

---

## 8. Modal System

One modal pattern used everywhere. Centered, with a dark overlay (rgba(0,0,0,0.6)).

```
overlay fills viewport
    ┌──────────────────────────────┐
    │ Modal title              [×] │
    ├──────────────────────────────┤
    │                              │
    │  Content area                │
    │                              │
    ├──────────────────────────────┤
    │ [Secondary action]  [Primary]│
    └──────────────────────────────┘
```

- Width: 480px max, 90vw on smaller screens
- bg-panel, border-default, radius-lg
- Title: text-base Inter 600
- Close [×]: top-right, text-muted, hover text-primary
- Footer: right-aligned buttons. Primary = accent-blue. Secondary = ghost (bg transparent, border-default).
- Pressing Escape closes. Clicking overlay closes (except destructive confirms).

---

## 9. Component Specifications

### Buttons
```
Primary:   bg accent-blue, text white, radius-md, px-16 py-8, Inter 500 14px
           Hover: opacity 0.9. Active: scale(0.98). Disabled: opacity 0.4.

Secondary: bg transparent, border-default, text-secondary, same sizing
           Hover: bg-hover. Active: scale(0.98).

Ghost:     bg transparent, no border, text-secondary
           Hover: bg-hover.

Danger:    bg accent-red, text white (for destructive actions only)

Icon-only: 32px square, radius-md, ghost style. Hover: bg-hover.
```

### Inputs
```
Height: 36px
bg: bg-elevated
border: 1px solid border-default
radius: radius-md
padding: px-12 py-8
font: Inter 400 14px text-primary
placeholder: text-muted

Focus: border-color accent-blue, box-shadow 0 0 0 2px rgba(0,122,204,0.2)
Error: border-color accent-red
Disabled: opacity 0.5, cursor not-allowed
```

### Role badges
```
Owner:       bg #3d3000  text #f9ab00  radius-sm px-6 py-2 text-xs Inter 500
Room Leader: bg #001a3d  text #9fcaff  radius-sm px-6 py-2 text-xs Inter 500
Editor:      bg #0a2510  text #34a853  radius-sm px-6 py-2 text-xs Inter 500
Viewer:      bg-elevated  text-muted  border-default  radius-sm px-6 py-2 text-xs Inter 500
```

### Avatar circles
```
Size options: 24px (chat), 32px (participant list), 40px (sidebar profile)
Shape: circle (radius-full)
bg: peer color (assigned on join, stored in user profile)
text: white, Inter 600, size scales with avatar (10px/12px/14px)
Content: first letter of display name, uppercase

Online indicator: 8px green circle, positioned bottom-right of avatar,
                  white 1.5px ring to separate from avatar bg
```

---

## 10. React Component Tree

```
App
├── AuthLayout (for login/register)
│   └── LoginPage
│       ├── BrandPanel
│       └── AuthCard
│           ├── TabSwitcher (sign-in / register)
│           ├── SignInForm
│           └── RegisterForm
│
└── AppLayout (authenticated shell)
    ├── TopBar
    │   ├── Logo
    │   ├── RoomName (in room only)
    │   ├── FileTabs (in room only)
    │   ├── RunButton (in room only)
    │   ├── LanguageSelector (in room only)
    │   ├── OnlineCount (in room only)
    │   └── AvatarMenu
    │
    ├── ActivityBar
    │   └── ActivityBarIcon (×5)
    │
    ├── Sidebar (collapsible)
    │   ├── DashboardNav (on dashboard)
    │   └── FileTree (in room)
    │       ├── FileTreeFolder
    │       └── FileTreeFile
    │
    ├── MainArea
    │   ├── DashboardPage
    │   │   ├── RoomList
    │   │   │   └── RoomCard
    │   │   ├── EmptyRoomState
    │   │   └── QuickJoin
    │   │
    │   └── RoomPage
    │       ├── EditorPane
    │       │   ├── MonacoEditor (+ Yjs binding)
    │       │   ├── CollabCursors
    │       │   ├── EditingIndicator ("N editing" pill)
    │       │   └── ViewOnlyWatermark (Viewer role only)
    │       └── BottomConsole (resizable)
    │           ├── ConsoleTabBar
    │           ├── TerminalTab
    │           ├── OutputTab
    │           └── ProblemsTab
    │
    ├── RightPanel (collapsible)
    │   ├── PanelTabBar
    │   ├── ParticipantsTab
    │   │   ├── LeaderControls (Owner/Room Leader only)
    │   │   ├── ParticipantRow
    │   │   └── ParticipantContextMenu
    │   └── ChatTab
    │       ├── ChatMessages
    │       │   ├── ChatMessage
    │       │   └── SystemMessage
    │       └── ChatInput
    │
    ├── VoiceDock (floating, room only)
    │   ├── MicButton
    │   ├── ChatShortcut
    │   ├── ParticipantsShortcut
    │   ├── LeaderAdminControls (Owner/Room Leader only)
    │   └── LeaveButton
    │
    ├── StatusBar
    │
    ├── ToastStack
    │   └── Toast
    │
    ├── Modal (portal)
    │
    └── SettingsDrawer
```

---

## 11. State Management (Zustand stores)

```
authStore:
  user: { id, displayName, email, avatarColor }
  accessToken: string | null   (in-memory only, never localStorage)
  isAuthenticated: boolean
  login(email, password) → void
  logout() → void
  refreshToken() → void

roomStore:
  rooms: Room[]
  currentRoom: Room | null
  myRole: 'Owner' | 'Room Leader' | 'Editor' | 'Viewer' | null
  participants: Participant[]
  createRoom(name) → Room
  joinRoom(uuid) → void
  leaveRoom() → void
  grantAccess(userId) → void
  revokeAccess(userId) → void
  grantAll() → void
  revokeAll() → void

editorStore:
  activeFile: string | null
  openFiles: string[]
  language: string
  openFile(path) → void
  closeFile(path) → void
  setLanguage(lang) → void

voiceStore:
  isInVoice: boolean
  isMuted: boolean
  isHardMuted: boolean
  speakingUsers: Set<string>
  joinVoice() → void
  leaveVoice() → void
  toggleMute() → void
  muteParticipant(socketId, hard) → void
  muteAll() → void

consoleStore:
  isOpen: boolean
  height: number
  activeTab: 'terminal' | 'output' | 'problems'
  output: OutputLine[]
  isExecuting: boolean
  runCode() → void
  clearOutput() → void

uiStore:
  sidebarOpen: boolean
  rightPanelOpen: boolean
  rightPanelTab: 'participants' | 'chat'
  toasts: Toast[]
  modal: ModalConfig | null
  addToast(toast) → void
  dismissToast(id) → void
  openModal(config) → void
  closeModal() → void
```

---

## 12. What NOT to build

This list prevents scope creep. If it's not in the backend, don't build UI for it.

- ❌ Video feed / camera feed (audio only)
- ❌ Camera button in toolbar or dock
- ❌ Screen share button
- ❌ Debug button (no debugger backend)
- ❌ Source control panel (no Git integration)
- ❌ Extensions panel (no plugin system)
- ❌ Search-across-files panel (no backend for this)
- ❌ "Browse Templates" feature
- ❌ "Initialize Project" feature
- ❌ OAuth (Google/GitHub) login buttons
- ❌ User profile photos (initials-only avatars)
- ❌ Persistent user profile side panel (use settings drawer instead)
- ❌ "v2.4.1" version number on login
- ❌ "Welcome back, Developer" copy (use real display name or nothing)
- ❌ Network quality indicator (no backend metric for this)

---

## 13. Accessibility baseline

Following ui-ux-pro-max UX guidelines — minimum requirements, not optional:

- All interactive elements keyboard-focusable with visible focus ring (2px accent-blue outline, 2px offset)
- Focus ring suppressed on mouse click (`:focus-visible` only)
- All icon-only buttons have `aria-label`
- Role badges use `role="status"` so screen readers announce changes
- Toast notifications use `role="alert"` `aria-live="polite"` (error toasts: `aria-live="assertive"`)
- Monaco editor: pass `aria-label="Code editor"` to the editor container
- Color is never the sole differentiator — speaking state uses text + color + animation
- `prefers-reduced-motion`: disable pulse animations, reduce transition durations to 1ms

---

## 14. Page routing

```
/                   → redirect to /dashboard if authed, else /login
/login              → LoginPage (sign in tab default)
/register           → LoginPage (register tab default)
/dashboard          → DashboardPage
/room/:uuid         → RoomPage
/room/:uuid/join    → join flow (validates invite, then redirects to /room/:uuid)
```

All routes except /login and /register require auth. Unauthenticated access redirects to /login with `?redirect=` param so user lands in the right place after login.

---

*CollabIDE UI/UX Specification v1.0 — July 2026*
*Bahria University Karachi Campus · BSE Final Year Project*
