const fs = require('fs');

let dash = fs.readFileSync('frontend/src/components/DashboardView.jsx', 'utf8');

const regex = /\{\/\* Activity Bar \(48px\) \*\/\}[\s\S]*?<\/aside>/;

const newActivityBar = `{/* Activity Bar (56px) */}
        <aside className="w-[56px] bg-surface-base border-r border-outline-subtle flex flex-col items-center py-4 shrink-0">
          <div className="flex flex-col gap-4 w-full items-center flex-1">
            <button className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#1c2b41]/60 text-[#9fcaff] transition-colors" title="Explorer">
              <span className="material-symbols-outlined">folder</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-lg text-outline opacity-40 cursor-not-allowed" disabled title="Participants (Disabled)">
              <span className="material-symbols-outlined">people</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-lg text-outline opacity-40 cursor-not-allowed" disabled title="Chat (Disabled)">
              <span className="material-symbols-outlined">chat</span>
            </button>
          </div>
          <div className="flex flex-col gap-4 w-full items-center">
            <button
              className="w-10 h-10 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-[#2b2d30] hover:text-on-surface transition-colors"
              title="Settings"
              onClick={() => setShowSettingsDrawer(true)}
            >
              <span className="material-symbols-outlined">settings</span>
            </button>
            <button
              className="w-10 h-10 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-[#2b2d30] hover:text-accent-red transition-colors"
              title="Sign Out"
              onClick={handleLogoutClick}
            >
              <span className="material-symbols-outlined">logout</span>
            </button>
          </div>
        </aside>`;

if (!regex.test(dash)) {
  console.log('Could not find Activity Bar');
  process.exit(1);
}

dash = dash.replace(regex, newActivityBar);

fs.writeFileSync('frontend/src/components/DashboardView.jsx', dash);
console.log('Activity Bar Fixed');
