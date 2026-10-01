const fs = require('fs');

let ws = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');
let dash = fs.readFileSync('frontend/src/components/DashboardView.jsx', 'utf8');

// Align headers to 56px
ws = ws.replace(
  /<header className="h-\[36px\] shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-2 z-40">/,
  '<header className="h-[56px] shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-4 z-40">'
);
// Fix the h-10 image if they want it bigger? Let's leave h-10 for logo.

dash = dash.replace(
  /<header className="h-\[36px\] shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-4 z-50">/,
  '<header className="h-[56px] shrink-0 bg-surface border-b border-outline-subtle flex items-center justify-between px-4 z-50">'
);

// Dashboard Sidebar - make it look like Workspace Explorer sidebar
dash = dash.replace(
  /<div className="px-4 py-2 text-text-xs font-semibold text-outline tracking-wider uppercase">Rooms<\/div>/,
  '<div className="px-2 py-1 flex items-center justify-between border-b border-outline-subtle mb-1"><span className="text-[9.5px] font-semibold text-on-surface uppercase tracking-wider">Rooms</span></div>'
);

// Dashboard tabs to match Workspace file list item styling
dash = dash.replace(
  /w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-\[13px\]/g,
  'w-full flex items-center gap-2 px-2 py-1.5 mx-1 my-0.5 rounded-md text-left text-[11px]'
);
dash = dash.replace(
  /text-\[18px\]/g,
  'text-[16px]'
);
dash = dash.replace(
  /text-text-sm/g,
  'text-[11px]'
);

// Write changes
fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', ws);
fs.writeFileSync('frontend/src/components/DashboardView.jsx', dash);

console.log('Done');
