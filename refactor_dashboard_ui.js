const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/DashboardView.jsx', 'utf8');

// 1. Fix Header height, background, and logo
code = code.replace(
  /<header className="h-\[56px\] shrink-0 bg-\[#121414\] border-b border-\[#2b2b2b\] flex items-center justify-between px-4 z-50">/,
  '<header className="h-[36px] shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-4 z-50">'
);
code = code.replace(
  /className="h-12 object-contain" alt="CollabIDE Logo"/,
  'className="h-10 object-contain" alt="CollabIDE Logo"'
);

// 2. Fix Sidebar background to match Workspace Explorer Panel
code = code.replace(
  /<aside className="w-\[240px\] bg-surface-base border-r border-outline-subtle flex flex-col shrink-0">/,
  '<aside className="w-[240px] bg-surface-panel border-r border-outline-subtle flex flex-col shrink-0">'
);

// 3. Fix Main area background
code = code.replace(
  /<main className="flex-1 bg-\[#121414\] overflow-y-auto">/,
  '<main className="flex-1 bg-surface overflow-y-auto">'
);

// 4. Fix modal/cards background if any hardcoded colors remain
code = code.replace(/bg-\[#1b1c1c\]/g, 'bg-surface-panel');
code = code.replace(/bg-\[#121414\]/g, 'bg-surface');
code = code.replace(/border-\[#404751\]/g, 'border-outline-subtle');
code = code.replace(/border-border-default/g, 'border-outline-subtle');

fs.writeFileSync('frontend/src/components/DashboardView.jsx', code);
console.log('Dashboard UI synced completely');
