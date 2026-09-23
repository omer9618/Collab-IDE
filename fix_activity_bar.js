const fs = require('fs');

let dash = fs.readFileSync('frontend/src/components/DashboardView.jsx', 'utf8');

const oldActivityBar = `        {/* Activity Bar (48px) */}
        <aside className="w-[48px] bg-[#0d0e0f] border-r border-[#2b2b2b] flex flex-col items-center py-4 shrink-0">
          <div className="flex flex-col gap-4 flex-1">
            <button className="w-10 h-10 flex items-center justify-center border-l-2 border-accent-blue text-accent-blue" title="Explorer">
              <span className="material-symbols-outlined">folder</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center text-outline opacity-40 cursor-not-allowed" disabled title="Participants (Disabled)">
              <span className="material-symbols-outlined">people</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center text-outline opacity-40 cursor-not-allowed" disabled title="Chat (Disabled)">
              <span className="material-symbols-outlined">chat</span>
            </button>
          </div>
          <div className="flex flex-col gap-4">
            <button
              className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              title="Settings"
              onClick={() => setShowSettingsDrawer(true)}
            >
              <span className="material-symbols-outlined">settings</span>
            </button>
            <button
              className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-accent-red"
              title="Sign Out"
              onClick={handleLogoutClick}
            >
              <span className="material-symbols-outlined">logout</span>
            </button>
          </div>
        </aside>`;

const newActivityBar = `        {/* Activity Bar (56px) */}
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

dash = dash.replace(oldActivityBar, newActivityBar);

fs.writeFileSync('frontend/src/components/DashboardView.jsx', dash);
console.log('Activity Bar Fixed');
