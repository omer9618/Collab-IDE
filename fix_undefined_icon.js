const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

const regex = /const fileColorDot = \(name\) => \{[\s\S]*?return 'bg-gray-500';\s*\};/;

const newFn = `const FileIcon = ({ name }) => {
                    if (!name) return <FileCode size={14} className="text-gray-400 shrink-0" />;
                    if (name.endsWith('.js') || name.endsWith('.jsx')) return <span className="text-[#eab308] font-bold text-[10px] w-3.5 text-center shrink-0">JS</span>;
                    if (name.endsWith('.ts') || name.endsWith('.tsx')) return <span className="text-[#3b82f6] font-bold text-[10px] w-3.5 text-center shrink-0">TS</span>;
                    if (name.endsWith('.py')) return <span className="text-[#3b82f6] font-bold text-[10px] w-3.5 text-center shrink-0">PY</span>;
                    if (name.endsWith('.java')) return <span className="text-[#ef4444] font-bold text-[10px] w-3.5 text-center shrink-0">J</span>;
                    if (name.endsWith('.cpp') || name.endsWith('.cc')) return <span className="text-[#a855f7] font-bold text-[10px] w-3.5 text-center shrink-0">C++</span>;
                    if (name.endsWith('.html')) return <span className="text-[#f97316] font-bold text-[10px] w-3.5 text-center shrink-0"><>&lt;/&gt;</></span>;
                    if (name.endsWith('.css')) return <span className="text-[#ec4899] font-bold text-[10px] w-3.5 text-center shrink-0">#</span>;
                    if (name.endsWith('.md')) return <span className="text-[#60a5fa] font-bold text-[10px] w-3.5 text-center shrink-0">M&#8595;</span>;
                    if (name.endsWith('.json')) return <span className="text-[#fef08a] font-bold text-[10px] w-3.5 text-center shrink-0">&#123;&#125;</span>;
                    if (name === '.env') return <Settings size={14} className="text-gray-400 shrink-0" />;
                    return <FileCode size={14} className="text-gray-400 shrink-0" />;
                  };`;

if (regex.test(code)) {
    code = code.replace(regex, newFn);
    fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', code);
    console.log('Replaced fileColorDot with FileIcon');
} else {
    console.log('regex not found');
}
