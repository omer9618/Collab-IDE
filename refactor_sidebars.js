const fs = require('fs');

// 1. DashboardView sidebar styling
let dash = fs.readFileSync('frontend/src/components/DashboardView.jsx', 'utf8');

dash = dash.replace(
  /<aside className="w-\[240px\] bg-\[#1b1c1c\] border-r border-\[#2b2b2b\] flex flex-col shrink-0">/,
  '<aside className="w-[240px] bg-surface-panel border-r border-outline-subtle flex flex-col shrink-0">'
);
dash = dash.replace(
  /className="p-4 border-b border-\[#2b2b2b\] cursor-pointer hover:bg-\[#252626\]\/60 transition-colors group"/,
  'className="p-4 border-b border-outline-subtle cursor-pointer hover:bg-surface-elevated transition-colors group"'
);
dash = dash.replace(
  /'bg-\[#1c2b41\]\/80 text-\[#9fcaff\]'/g,
  "'bg-accent-blue/10 text-accent-blue'"
);
dash = dash.replace(
  /'text-on-surface-variant hover:bg-\[#2b2d30\]\/60 hover:text-on-surface'/g,
  "'text-on-surface-variant hover:bg-surface-elevated hover:text-on-surface'"
);

fs.writeFileSync('frontend/src/components/DashboardView.jsx', dash);

// 2. WorkspaceView chat panel width
let ws = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

ws = ws.replace(
  /const \[rightPanelWidth, setRightPanelWidth\] = useState\(200\);/,
  'const [rightPanelWidth, setRightPanelWidth] = useState(280);'
);
ws = ws.replace(
  /setRightPanelWidth\(Math\.max\(150, Math\.min\(startWidth - \(moveEvent\.clientX - startX\), 600\)\)\);/,
  'setRightPanelWidth(Math.max(250, Math.min(startWidth - (moveEvent.clientX - startX), 600)));'
);

fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', ws);
console.log('Sidebars refactored');
