/**
 * @file scripts/precompress.js
 * @description Pre-compresses static assets in frontend/dist (> 1KB) using native zlib.
 * Generates .gz sidecar files for Nginx gzip_static (NFR-41, NFR-42).
 * Zero external dependencies — uses Node.js standard library.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

const COMPRESSIBLE_EXTENSIONS = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt']);
const MIN_SIZE_BYTES = 1024; // 1KB threshold per NFR-42

function walkAndPrecompress(dir) {
  if (!fs.existsSync(dir)) {
    console.warn(`[precompress] Directory not found: ${dir}`);
    return 0;
  }

  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += walkAndPrecompress(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();

      // Skip already compressed sidecars
      if (entry.name.endsWith('.gz') || entry.name.endsWith('.br')) {
        continue;
      }

      if (COMPRESSIBLE_EXTENSIONS.has(ext)) {
        const stats = fs.statSync(fullPath);
        if (stats.size >= MIN_SIZE_BYTES) {
          const content = fs.readFileSync(fullPath);
          const compressed = zlib.gzipSync(content, { level: 9 });
          fs.writeFileSync(`${fullPath}.gz`, compressed);
          count++;
        }
      }
    }
  }

  return count;
}

console.log('[precompress] Generating .gz sidecar files for Nginx gzip_static (NFR-41, NFR-42)...');
const total = walkAndPrecompress(DIST_DIR);
console.log(`[precompress] Successfully generated ${total} pre-compressed .gz sidecar files in ${DIST_DIR}`);
