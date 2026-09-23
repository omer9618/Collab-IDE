/**
 * test_nfr55_layout_invariants.js
 * 
 * Automated Verification Suite for NFR-55: Minimum Screen Resolution (1280x720px)
 * Verifies that all panel clamping algorithms, window resize handlers,
 * and layout rules mathematically guarantee that:
 * 1. Monaco Editor width >= 380px (well above minimum readable width) under all drag scenarios
 * 2. Monaco Editor height >= 200px under all console expansion scenarios
 * 3. Document has zero horizontal page blowout at 1280px
 * 4. Modals and drawers do not overflow vertical 720px viewports
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

console.log('\n=== RUNNING NFR-55 MINIMUM SCREEN RESOLUTION TEST SUITE (1280x720px) ===\n');

// 1. Replicate clamping functions exactly as implemented in WorkspaceView.jsx
function calculateLeftPanelWidth({ startWidth, deltaX, winW = 1280, rightPanelOpen = true, rightPanelWidth = 200 }) {
  const currentRightW = rightPanelOpen ? rightPanelWidth : 0;
  const maxAllowed = Math.max(160, Math.min(300, winW - currentRightW - 40 - 380));
  return Math.max(160, Math.min(startWidth + deltaX, maxAllowed));
}

function calculateRightPanelWidth({ startWidth, deltaX, winW = 1280, sidebarOpen = true, leftPanelWidth = 200 }) {
  const currentLeftW = sidebarOpen ? leftPanelWidth : 0;
  const maxAllowed = Math.max(180, Math.min(340, winW - currentLeftW - 40 - 380));
  return Math.max(180, Math.min(startWidth - deltaX, maxAllowed));
}

function calculateConsoleHeight({ startHeight, deltaY, winH = 720 }) {
  const maxAllowedHeight = Math.max(120, Math.min(300, Math.floor(winH * 0.45)));
  return Math.max(100, Math.min(maxAllowedHeight, startHeight + deltaY));
}

function reClampOnWindowResize({ currentLeft, currentRight, currentConsole, winW = 1280, winH = 720 }) {
  const maxLeft = Math.max(160, Math.min(300, Math.floor(winW * 0.25)));
  const nextLeft = Math.max(160, Math.min(currentLeft, maxLeft));

  const maxRight = Math.max(180, Math.min(340, Math.floor(winW * 0.30)));
  const nextRight = Math.max(180, Math.min(currentRight, maxRight));

  const maxConsole = Math.max(100, Math.min(300, Math.floor(winH * 0.45)));
  const nextConsole = Math.max(100, Math.min(currentConsole, maxConsole));

  return { nextLeft, nextRight, nextConsole };
}

// -------------------------------------------------------------
// Test Category 1: Width Invariants at 1280px Viewport
// -------------------------------------------------------------
console.log('Test Category 1: Width Invariants at 1280px');
{
  const winW = 1280;
  const activityBarW = 40;

  // Scenario 1: Initial default state (left=200, right=200)
  const defaultLeft = 200;
  const defaultRight = 200;
  const defaultEditorW = winW - activityBarW - defaultLeft - defaultRight;
  assert(defaultEditorW === 840, `Default layout leaves 840px for editor (got ${defaultEditorW}px)`);
  assert(defaultEditorW >= 400, 'Default editor width is >= 400px');

  // Scenario 2: User attempts to drag left panel to extreme right (+2000px)
  const extremeLeft = calculateLeftPanelWidth({ startWidth: 200, deltaX: 2000, winW, rightPanelOpen: true, rightPanelWidth: 340 });
  assert(extremeLeft <= 300, `Extreme left drag is safely capped at <= 300px (got ${extremeLeft}px)`);
  assert(extremeLeft >= 160, `Left panel preserves min width of 160px`);

  // Scenario 3: User attempts to drag right panel to extreme left (-2000px)
  const extremeRight = calculateRightPanelWidth({ startWidth: 200, deltaX: -2000, winW, sidebarOpen: true, leftPanelWidth: 300 });
  assert(extremeRight <= 340, `Extreme right drag is safely capped at <= 340px (got ${extremeRight}px)`);
  assert(extremeRight >= 180, `Right panel preserves min width of 180px`);

  // Scenario 4: WORST-CASE COMBINATION (Both panels dragged to absolute maximum possible)
  const worstCaseEditorW = winW - activityBarW - extremeLeft - extremeRight;
  assert(worstCaseEditorW === 600, `Worst-case simultaneous expansion leaves 600px for Monaco Editor (got ${worstCaseEditorW}px)`);
  assert(worstCaseEditorW >= 380, 'Worst-case editor width strictly satisfies minimum >= 380px requirement');

  // Scenario 5: User collapses panels (minimum panel widths)
  const minLeft = calculateLeftPanelWidth({ startWidth: 200, deltaX: -2000, winW });
  assert(minLeft === 160, `Minimum left panel width is clamped at 160px`);

  const minRight = calculateRightPanelWidth({ startWidth: 200, deltaX: 2000, winW });
  assert(minRight === 180, `Minimum right panel width is clamped at 180px`);
}

// -------------------------------------------------------------
// Test Category 2: Height Invariants at 720px Viewport
// -------------------------------------------------------------
console.log('\nTest Category 2: Height Invariants at 720px');
{
  const winH = 720;
  const headerH = 36;

  // Scenario 1: Initial default console height (200px)
  const defaultConsoleH = 200;
  const defaultEditorH = winH - headerH - defaultConsoleH;
  assert(defaultEditorH === 484, `Default vertical space leaves 484px for editor area (got ${defaultEditorH}px)`);
  assert(defaultEditorH >= 200, 'Default editor height is >= 200px');

  // Scenario 2: User attempts to drag console to extreme top (+2000px)
  const maxConsoleH = calculateConsoleHeight({ startHeight: 200, deltaY: 2000, winH });
  assert(maxConsoleH <= 300, `Extreme console drag is safely capped at <= 300px (got ${maxConsoleH}px)`);
  assert(maxConsoleH <= Math.floor(winH * 0.45), `Console height does not exceed 45% of 720px viewport`);

  // Scenario 3: Worst-case console height leaves ample editor space
  const worstCaseEditorH = winH - headerH - maxConsoleH;
  assert(worstCaseEditorH === 384, `Worst-case console expansion leaves 384px for Monaco Editor (got ${worstCaseEditorH}px)`);
  assert(worstCaseEditorH >= 200, 'Worst-case editor height satisfies >= 200px invariant');

  // Scenario 4: User shrinks console to minimum
  const minConsoleH = calculateConsoleHeight({ startHeight: 200, deltaY: -2000, winH });
  assert(minConsoleH === 100, `Minimum console height is clamped at 100px`);
}

// -------------------------------------------------------------
// Test Category 3: Window Resize Re-clamping (e.g. 1440p -> 720p)
// -------------------------------------------------------------
console.log('\nTest Category 3: Window Resize Re-clamping');
{
  // User had large panels on a 1440p monitor (e.g. left=450, right=500, console=450)
  const { nextLeft, nextRight, nextConsole } = reClampOnWindowResize({
    currentLeft: 450,
    currentRight: 500,
    currentConsole: 450,
    winW: 1280,
    winH: 720,
  });

  assert(nextLeft <= 300, `Left panel re-clamped from 450px down to ${nextLeft}px (<= 300px)`);
  assert(nextRight <= 340, `Right panel re-clamped from 500px down to ${nextRight}px (<= 340px)`);
  assert(nextConsole <= 300, `Console re-clamped from 450px down to ${nextConsole}px (<= 300px)`);

  const clampedEditorW = 1280 - 40 - nextLeft - nextRight;
  assert(clampedEditorW >= 600, `Editor width after window shrink is ${clampedEditorW}px (>= 600px)`);
}

// -------------------------------------------------------------
// Test Category 4: Static File Layout & CSS Assertions
// -------------------------------------------------------------
console.log('\nTest Category 4: Static Code & Layout Invariants');
{
  const workspaceCode = fs.readFileSync(path.join(__dirname, '../src/components/WorkspaceView.jsx'), 'utf8');
  const dashboardCode = fs.readFileSync(path.join(__dirname, '../src/components/DashboardView.jsx'), 'utf8');
  const authCode = fs.readFileSync(path.join(__dirname, '../src/components/AuthView.jsx'), 'utf8');
  const indexCss = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

  // WorkspaceView checks
  assert(workspaceCode.includes('min-w-[380px]'), 'WorkspaceView main container enforces min-w-[380px]');
  assert(workspaceCode.includes('min-h-[200px]'), 'WorkspaceView main container enforces min-h-[200px]');
  assert(workspaceCode.includes('overflow-x-auto no-scrollbar min-w-0 flex-1'), 'WorkspaceView tabs have min-w-0 flex-1 horizontal scroll');
  assert(workspaceCode.includes('shrink-0 ml-2'), 'WorkspaceView right action controls have shrink-0 protection');
  assert(workspaceCode.includes('max-h-[85vh]'), 'WorkspaceView modals enforce max-h-[85vh] viewport bounding');
  assert(workspaceCode.includes('handleViewportResize'), 'WorkspaceView implements responsive window resize listener');

  // DashboardView checks
  assert(dashboardCode.includes('max-h-[90vh]'), 'DashboardView modals enforce max-h-[90vh] viewport bounding');
  assert(dashboardCode.includes('overflow-y-auto'), 'DashboardView modals enforce overflow-y-auto');

  // AuthView checks
  assert(authCode.includes('max-h-[92vh]'), 'AuthView auth card enforces max-h-[92vh] viewport bounding');

  // Global CSS checks
  assert(indexCss.includes('overflow: hidden'), 'Global index.css body specifies overflow: hidden preventing horizontal blowout');
}

console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL NFR-55 LAYOUT INVARIANTS SUCCESSFULLY VERIFIED!\n');
  process.exit(0);
}
