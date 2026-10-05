const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, 'frontend/src/components');

// Color mapping to semantic classes
const replacements = [
  { regex: /bg-\[\#(121414|121314|0d0e0f|181818|18191a|181a1b|141618|181825|1e1e2e|182334)\]/g, replace: 'bg-surface' },
  { regex: /bg-\[\#(1b1c1c|1a1b1b|1f2020|1f2021|202225|1e2022)\]/g, replace: 'bg-surface-panel' },
  { regex: /hover:bg-\[\#(252626|2b2d30|292a2a|2a2d2e|3e3e42|37373d|252526)\]/g, replace: 'hover:bg-surface-hover' },
  { regex: /bg-\[\#(252626|2b2d30|292a2a|2a2d2e|3e3e42|37373d|252526)\]/g, replace: 'bg-surface-hover' },
  { regex: /bg-\[\#3c3c3c\]/g, replace: 'bg-surface-active' },
  { regex: /border-\[\#(2b2b2b|303338|333)\]/g, replace: 'border-outline-subtle' },
  { regex: /border-\[\#(404751|444)\]/g, replace: 'border-outline' },
  { regex: /text-\[\#(e3e2e2|e3e2e3)\]/g, replace: 'text-primary' },
  { regex: /text-\[\#c0c7d3\]/g, replace: 'text-secondary' },
  { regex: /text-\[\#8a919d\]/g, replace: 'text-muted' },
  { regex: /text-\[\#9fcaff\]/g, replace: 'text-accent-blue' },
  { regex: /bg-\[\#1c2b41\]/g, replace: 'bg-accent-blue/10' },
  { regex: /bg-\[\#0d2e1a\]/g, replace: 'bg-green-900/20' },
  { regex: /bg-\[\#0a2510\]/g, replace: 'bg-green-900/20' },
  { regex: /bg-\[\#2b1d3d\]/g, replace: 'bg-purple-900/20' },
  { regex: /bg-\[\#2a0e38\]/g, replace: 'bg-purple-900/20' },
  { regex: /bg-\[\#3d3000\]/g, replace: 'bg-yellow-900/20' },
  { regex: /bg-\[\#707070\]/g, replace: 'bg-surface-hover' }
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.jsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let modified = false;
      
      for (const { regex, replace } of replacements) {
        if (regex.test(content)) {
          content = content.replace(regex, replace);
          modified = true;
        }
      }
      
      if (modified) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

processDirectory(directory);
