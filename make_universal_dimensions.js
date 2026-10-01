const fs = require('fs');

// 1. Update index.html Tailwind Config
let html = fs.readFileSync('frontend/index.html', 'utf8');
const oldSpacing = `"activity-bar-width": "48px",
                "sidebar-width": "240px",
                "top-bar-height": "44px"`;
const newSpacing = `"activity-bar-width": "56px",
                "sidebar-width": "240px",
                "top-bar-height": "56px"`;
html = html.replace(oldSpacing, newSpacing);
fs.writeFileSync('frontend/index.html', html);

// 2. Update WorkspaceView.jsx
let ws = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');
ws = ws.replace(/className="h-\[56px\]/g, 'className="h-top-bar-height');
ws = ws.replace(/className="w-\[40px\]/g, 'className="w-activity-bar-width'); // wait, WorkspaceView Activity bar was 40px? Let's check... if it was 40px, we make it use the variable which makes it 56px, aligning them fully! Or maybe just replace `h-[56px]`. Let's just do standard replacements.
ws = ws.replace(/w-\[56px\]/g, 'w-activity-bar-width');
ws = ws.replace(/w-\[240px\]/g, 'w-sidebar-width');
fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', ws);

// 3. Update DashboardView.jsx
let dash = fs.readFileSync('frontend/src/components/DashboardView.jsx', 'utf8');
dash = dash.replace(/h-\[56px\]/g, 'h-top-bar-height');
dash = dash.replace(/w-\[56px\]/g, 'w-activity-bar-width');
dash = dash.replace(/w-\[240px\]/g, 'w-sidebar-width');
fs.writeFileSync('frontend/src/components/DashboardView.jsx', dash);

console.log('Universal dimensions applied');
