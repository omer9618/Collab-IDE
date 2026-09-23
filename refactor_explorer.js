const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

// Replace fileColorDot logic with new fileIcon component logic
code = code.replace(
  /const fileColorDot = \(name\) => \{[\s\S]*?return 'bg-gray-500';\n                  \};/,
  `const FileIcon = ({ name }) => {
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
                  };`
);

// We need to replace the Explorer panel UI completely.
// Let's find the start of {/* Sidebar explorer panel */} and replace until {isFilesTreeOpen && (() => {
const sidebarExplorerRegex = /\{\/\* Sidebar explorer panel \*\/\}[\s\S]*?(?=\{\/\* File\/Folder Tree \*\/)/;

const newSidebarExplorer = `{/* Sidebar explorer panel */}
          {sidebarOpen && (
            <nav style={{ width: \`\${leftPanelWidth}px\` }} className="h-full bg-[#181818] border-r border-outline-subtle flex flex-col shrink-0 select-none relative">
              <div className="absolute top-0 right-0 w-[4px] h-full bg-transparent hover:bg-accent-blue cursor-col-resize transition-colors z-50 translate-x-1/2" onMouseDown={handleLeftPanelResize} />
              
              {/* Explorer Top Header */}
              <div className="px-5 py-2.5 flex items-center justify-between text-on-surface-muted">
                <span className="text-[11px] text-on-surface uppercase tracking-wide">Explorer</span>
                <button className="p-0.5 hover:bg-[#2a2d2e] rounded"><MoreHorizontal size={14} /></button>
              </div>

              <div className="flex-1 overflow-y-auto outline-none custom-scrollbar pb-4" tabIndex={0}>
                {/* Workspace Root Row */}
                <div 
                  className="px-1 py-1 flex items-center justify-between group/root cursor-pointer hover:bg-[#2a2d2e] transition-colors"
                  onClick={() => setIsFilesTreeOpen(!isFilesTreeOpen)}
                >
                  <div className="flex items-center gap-0.5 min-w-0 flex-1">
                    <span
                      className="material-symbols-outlined text-[16px] text-on-surface-muted transition-transform duration-150 shrink-0"
                      style={{ transform: isFilesTreeOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      chevron_right
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface truncate">{room?.name || 'Workspace'}</span>
                  </div>

                  {/* Root Action Icons */}
                  {role !== 'Viewer' && (
                    <div className="flex items-center gap-1 opacity-0 group-hover/root:opacity-100 transition-opacity mr-2 shrink-0">
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); handleCreateFile(''); }}
                        title="New File"
                      >
                        <span className="material-symbols-outlined text-[15px]">note_add</span>
                      </button>
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); handleCreateFolder(''); }}
                        title="New Folder"
                      >
                        <span className="material-symbols-outlined text-[15px]">create_new_folder</span>
                      </button>
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); showToast('Explorer synced', 'info'); }}
                        title="Refresh Explorer"
                      >
                        <span className="material-symbols-outlined text-[15px]">sync</span>
                      </button>
                      <button
                        className="p-0.5 text-on-surface-muted hover:text-on-surface rounded"
                        onClick={(e) => { e.stopPropagation(); setExpandedFolders(new Set()); }}
                        title="Collapse All"
                      >
                        <span className="material-symbols-outlined text-[15px]">collapse_all</span>
                      </button>
                    </div>
                  )}
                </div>

                `;

code = code.replace(sidebarExplorerRegex, newSidebarExplorer);

// Now we replace the renderTree function.
const renderTreeRegex = /const renderTree = \(nodes, depth = 0\) => \([\s\S]*?(?=const tree = buildFileTree\(files\);)/;

const newRenderTree = `const renderTree = (nodes, depth = 0) => (
                    <div className="flex flex-col">
                      {nodes.map((node) => {
                        const indent = depth * 12 + 16;
                        if (node.type === 'folder') {
                          const isOpen = expandedFolders.has(node.path);
                          return (
                            <div key={node.path}>
                              {/* Folder Row */}
                              <div
                                className="flex items-center py-[3px] cursor-pointer text-on-surface-variant hover:text-on-surface hover:bg-[#2a2d2e] group/folder transition-colors"
                                style={{ paddingLeft: \`\${indent}px\`, paddingRight: '8px' }}
                                onClick={() => setExpandedFolders(prev => {
                                  const s = new Set(prev);
                                  if (s.has(node.path)) s.delete(node.path); else s.add(node.path);
                                  return s;
                                })}
                              >
                                <span
                                  className="material-symbols-outlined text-[16px] text-on-surface-muted transition-transform duration-100 shrink-0 mr-1"
                                  style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                >
                                  chevron_right
                                </span>
                                <span className="material-symbols-outlined text-[15px] text-on-surface-muted shrink-0 mr-1.5">
                                  {isOpen ? 'folder_open' : 'folder'}
                                </span>
                                <span className="text-[12.5px] truncate flex-1">{node.name}</span>

                                {/* Folder hover actions */}
                                {role !== 'Viewer' && (
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity ml-auto shrink-0">
                                    <button
                                      className="p-0.5 hover:bg-[#3e3e42] rounded text-on-surface-muted hover:text-on-surface"
                                      onClick={(e) => { e.stopPropagation(); handleCreateFile(node.path); }}
                                      title="New File"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">note_add</span>
                                    </button>
                                    <button
                                      className="p-0.5 hover:bg-[#3e3e42] rounded text-on-surface-muted hover:text-on-surface"
                                      onClick={(e) => { e.stopPropagation(); handleCreateFolder(node.path); }}
                                      title="New Folder"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">create_new_folder</span>
                                    </button>
                                    <button
                                      className="p-0.5 hover:bg-red-500/20 rounded text-on-surface-muted hover:text-red-400"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteFolder(node.path); }}
                                      title="Delete Folder"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">delete</span>
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Inline folder/file creation input shown inside this folder */}
                              {isOpen && isCreatingFolder && createInsideFolder === node.path && (
                                <div
                                  className="flex items-center py-[3px] bg-[#2a2d2e]"
                                  style={{ paddingLeft: \`\${indent + 28}px\`, paddingRight: '8px' }}
                                >
                                  <span className="material-symbols-outlined text-[15px] text-on-surface-muted shrink-0 mr-1.5">folder</span>
                                  <input
                                    id="new-folder-input"
                                    type="text"
                                    className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full"
                                    value={newFolderNameInput}
                                    onChange={(e) => setNewFolderNameInput(e.target.value)}
                                    onKeyDown={handleNewFolderKeyDown}
                                    onBlur={handleCommitNewFolder}
                                    autoFocus
                                  />
                                </div>
                              )}
                              {isOpen && isCreatingFile && createInsideFolder === node.path && (
                                <div
                                  className="flex items-center py-[3px] bg-[#2a2d2e]"
                                  style={{ paddingLeft: \`\${indent + 28}px\`, paddingRight: '8px' }}
                                >
                                  <FileIcon name={newFileNameInput || 'new'} />
                                  <input
                                    id="new-file-input"
                                    type="text"
                                    className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full ml-1.5"
                                    value={newFileNameInput}
                                    onChange={(e) => setNewFileNameInput(e.target.value)}
                                    onKeyDown={handleNewFileKeyDown}
                                    onBlur={handleCommitNewFile}
                                    autoFocus
                                  />
                                </div>
                              )}

                              {/* Children */}
                              {isOpen && renderTree(node.children, depth + 1)}
                            </div>
                          );
                        }

                        // File Row
                        return (
                          <div
                            key={node.path}
                            className={\`flex items-center py-[3px] cursor-pointer transition-colors group/file \${
                              activeFile === node.path
                                ? 'bg-[#37373d] text-white'
                                : 'text-on-surface-variant hover:text-on-surface hover:bg-[#2a2d2e]'
                            }\`}
                            style={{ paddingLeft: \`\${indent + 20}px\`, paddingRight: '8px' }}
                            onClick={() => {
                              setActiveFile(node.path);
                              if (!openedFiles.includes(node.path)) {
                                setOpenedFiles([...openedFiles, node.path]);
                              }
                            }}
                            onDoubleClick={(e) => handleFileDoubleClick(e, node.path)}
                            onContextMenu={(e) => handleFileDoubleClick(e, node.path)}
                          >
                            <FileIcon name={node.name} />
                            {renamingFileName === node.path ? (
                              <input
                                id="rename-file-input"
                                type="text"
                                className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full ml-1.5"
                                value={renameInputVal}
                                onChange={(e) => setRenameInputVal(e.target.value)}
                                onKeyDown={(e) => handleRenameKeyDown(e, node.path)}
                                onBlur={() => handleCommitRename(node.path)}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="text-[12.5px] truncate flex-1 ml-1.5">{node.name}</span>
                            )}
                            {role !== 'Viewer' && renamingFileName !== node.path && (
                              <button
                                className="ml-auto shrink-0 text-on-surface-muted hover:text-on-surface opacity-0 group-hover/file:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#3e3e42]"
                                onClick={(e) => { e.stopPropagation(); handleFileDoubleClick(e, node.path); }}
                                title="File options"
                              >
                                <span className="material-symbols-outlined text-[14px]">more_horiz</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                  
                  `;

code = code.replace(renderTreeRegex, newRenderTree);

// Fix the root level inputs styling too
const rootInputsRegex = /\{isCreatingFolder && createInsideFolder === '' && \([\s\S]*?(?=\{renderTree\(tree\)\})/m;
const newRootInputs = `{isCreatingFolder && createInsideFolder === '' && (
                        <div className="flex items-center py-[3px] bg-[#2a2d2e]" style={{ paddingLeft: '32px', paddingRight: '8px' }}>
                          <span className="material-symbols-outlined text-[15px] text-on-surface-muted shrink-0 mr-1.5">folder</span>
                          <input
                            id="new-folder-input"
                            type="text"
                            className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full"
                            value={newFolderNameInput}
                            onChange={(e) => setNewFolderNameInput(e.target.value)}
                            onKeyDown={handleNewFolderKeyDown}
                            onBlur={handleCommitNewFolder}
                            autoFocus
                          />
                        </div>
                      )}
                      {isCreatingFile && createInsideFolder === '' && (
                        <div className="flex items-center py-[3px] bg-[#2a2d2e]" style={{ paddingLeft: '32px', paddingRight: '8px' }}>
                          <FileIcon name={newFileNameInput || 'new'} />
                          <input
                            id="new-file-input"
                            type="text"
                            className="bg-[#3c3c3c] border border-[#007acc] text-[12px] px-1 py-0.5 text-on-surface outline-none w-full ml-1.5"
                            value={newFileNameInput}
                            onChange={(e) => setNewFileNameInput(e.target.value)}
                            onKeyDown={handleNewFileKeyDown}
                            onBlur={handleCommitNewFile}
                            autoFocus
                          />
                        </div>
                      )}
                      `;

code = code.replace(rootInputsRegex, newRootInputs);

// Also need to replace the <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${fileColorDot(node.name)}`} />
// Oh wait, fileColorDot usage inside file rendering is already gone because I rewrote renderTree!
// Let me double check if there are other usages of fileColorDot:
code = code.replace(/<span className=\{\`w-2\.5 h-2\.5 rounded-full shrink-0 \$\{fileColorDot\(node\.name\)\}\`\} \/>/g, '<FileIcon name={node.name} />');

// Let's remove the <span className="material-symbols-outlined text-[12px] text-on-surface-muted">folder_open</span> in root row:
// Ah, the new sidebar explorer already replaced the root row so it's fine.

fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', code);
console.log('UI updated for explorer to match VSCode style');
