const fs = require('fs');

let dash = fs.readFileSync('frontend/src/components/DashboardView.jsx', 'utf8');

// Add the state variable
const stateHookPos = dash.indexOf("const [activeTab, setActiveTab] = useState('my-rooms'); // my-rooms, joined-rooms");
if (stateHookPos !== -1) {
  dash = dash.substring(0, stateHookPos) + "const [sidebarOpen, setSidebarOpen] = useState(true);\n  " + dash.substring(stateHookPos);
}

// Update the folder icon button to toggle state and highlight properly
const oldFolderBtnRegex = /<button className="w-10 h-10 flex items-center justify-center rounded-lg bg-\[#1c2b41\]\/60 text-\[#9fcaff\] transition-colors" title="Explorer">/g;
const newFolderBtn = `<button
              className={\`w-10 h-10 flex items-center justify-center rounded-lg transition-colors \${
                sidebarOpen ? 'bg-[#1c2b41]/60 text-[#9fcaff]' : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2b2d30]'
              }\`}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Explorer"
            >`;
dash = dash.replace(oldFolderBtnRegex, newFolderBtn);

// Wrap the 240px sidebar in {sidebarOpen && (...)}
// First find the start of the 240px sidebar
const sidebarStart = `{/* Sidebar (240px) */}
        <aside className="w-[240px] bg-surface-panel border-r border-outline-subtle flex flex-col shrink-0">`;
const sidebarReplacement = `{/* Sidebar (240px) */}
        {sidebarOpen && (
        <aside className="w-[240px] bg-surface-panel border-r border-outline-subtle flex flex-col shrink-0">`;
dash = dash.replace(sidebarStart, sidebarReplacement);

// Find the end of the sidebar
// It ends right before {/* Main Content Area */}
const mainContentStart = `        {/* Main Content Area */}`;
const sidebarEndRegex = /(<\/aside>\s*)({\/\* Main Content Area \*\/})/g;
dash = dash.replace(sidebarEndRegex, `$1        )}\n\n        $2`);

fs.writeFileSync('frontend/src/components/DashboardView.jsx', dash);
console.log("Toggle fixed");
