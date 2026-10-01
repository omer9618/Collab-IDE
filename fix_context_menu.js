const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

const menuCode = `
      {/* File Options Menu */}
      {activeFileMenu && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setActiveFileMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setActiveFileMenu(null); }}
          />
          <div
            className="fixed z-[101] bg-[#252526] border border-[#454545] rounded-md shadow-2xl py-1 min-w-[140px] flex flex-col"
            style={{ top: activeFileMenu.y, left: activeFileMenu.x }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-on-surface hover:bg-[#37373d] transition-colors"
              onClick={() => {
                handleRenameFile(activeFileMenu.fileName);
                setActiveFileMenu(null);
              }}
            >
              Rename
            </button>
            <div className="h-px w-full bg-[#454545] my-1" />
            <button
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-400 hover:bg-[#37373d] transition-colors"
              onClick={() => {
                handleDeleteFile(activeFileMenu.fileName);
                setActiveFileMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
`;

// Insert right before the final "    </div>\n  );\n}"
const insertTarget = '    </div>\n  );\n}';
if (code.includes(insertTarget)) {
    code = code.replace(insertTarget, menuCode + '\n' + insertTarget);
    fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', code);
    console.log('Inserted activeFileMenu block.');
} else {
    // try slightly different spacing
    const insertTarget2 = '    </div>\r\n  );\r\n}';
    if (code.includes(insertTarget2)) {
        code = code.replace(insertTarget2, menuCode + '\n' + insertTarget2);
        fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', code);
        console.log('Inserted activeFileMenu block (CRLF).');
    } else {
        console.log('Could not find insertion point.');
    }
}
