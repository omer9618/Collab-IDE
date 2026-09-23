const fs = require('fs');

// Fix VoiceDeviceMenu.jsx
let menu = fs.readFileSync('frontend/src/components/VoiceDeviceMenu.jsx', 'utf8');
menu = menu.replace(/bg-\[#202124\]/g, 'bg-surface-elevated');
menu = menu.replace(/hover:bg-\[#303134\]/g, 'hover:bg-surface-variant');
fs.writeFileSync('frontend/src/components/VoiceDeviceMenu.jsx', menu);

// Fix WorkspaceView.jsx
let ws = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

// Replace floating dock colors
ws = ws.replace(/bg-\[#202124\]/g, 'glass-panel bg-surface/90');
ws = ws.replace(/bg-\[#ea4335\]/g, 'bg-accent-red');
ws = ws.replace(/hover:bg-\[#d93025\]/g, 'hover:opacity-90');
ws = ws.replace(/bg-\[#3c4043\] text-white border-transparent hover:bg-\[#434649\]/g, 'bg-surface-variant text-on-surface hover:bg-outline-subtle');
ws = ws.replace(/bg-\[#3c4043\]/g, 'bg-outline'); // for divider
ws = ws.replace(/text-\[#ea4335\]/g, 'text-accent-red');
ws = ws.replace(/hover:bg-\[#ea4335\]\/10/g, 'hover:bg-accent-red/10');
ws = ws.replace(/text-\[#8ab4f8\]/g, 'text-accent-blue');
ws = ws.replace(/hover:bg-\[#8ab4f8\]\/10/g, 'hover:bg-accent-blue/10');
ws = ws.replace(/bg-\[#8ab4f8\]/g, 'bg-accent-blue');
ws = ws.replace(/hover:bg-\[#92bcfc\]/g, 'hover:bg-blue-600');
ws = ws.replace(/text-\[#202124\]/g, 'text-white');

fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', ws);
console.log('Themed updated');
