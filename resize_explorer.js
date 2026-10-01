const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/WorkspaceView.jsx', 'utf8');

// Replace FileIcon text and size
code = code.replace(/text-\[10px\]/g, 'text-[9px]');
code = code.replace(/size=\{14\}/g, 'size={12}');

// We want to scope the renderTree replacements
let startIndex = code.indexOf('const renderTree = (nodes, depth = 0) => (');
let endIndex = code.indexOf('const tree = buildFileTree(files);');

if (startIndex !== -1 && endIndex !== -1) {
    let renderTreeCode = code.substring(startIndex, endIndex);

    // Replace padding
    renderTreeCode = renderTreeCode.replace(/py-\[3px\]/g, 'py-[1px]');
    // Replace text sizes
    renderTreeCode = renderTreeCode.replace(/text-\[16px\]/g, 'text-[14px]');
    renderTreeCode = renderTreeCode.replace(/text-\[15px\]/g, 'text-[14px]');
    renderTreeCode = renderTreeCode.replace(/text-\[12\.5px\]/g, 'text-[11.5px]');
    renderTreeCode = renderTreeCode.replace(/text-\[14px\]/g, 'text-[13px]');

    code = code.substring(0, startIndex) + renderTreeCode + code.substring(endIndex);
}

// Also fix the rootInputs block that uses py-[3px]
let rootStartIndex = code.indexOf('{isCreatingFolder && createInsideFolder === \'\' && (');
let rootEndIndex = code.indexOf('{renderTree(tree)}');
if (rootStartIndex !== -1 && rootEndIndex !== -1) {
    let rootCode = code.substring(rootStartIndex, rootEndIndex);
    rootCode = rootCode.replace(/py-\[3px\]/g, 'py-[1px]');
    rootCode = rootCode.replace(/text-\[15px\]/g, 'text-[14px]');
    code = code.substring(0, rootStartIndex) + rootCode + code.substring(rootEndIndex);
}

fs.writeFileSync('frontend/src/components/WorkspaceView.jsx', code);
console.log('Resized explorer rows, fonts, and icons.');
