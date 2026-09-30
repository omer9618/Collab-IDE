/**
 * @file scripts/precompress.js
 * @description Precompression Utility for Static Assets (NFR-42).
 * 
 * Generates maximum-compression .gz (Gzip) and .br (Brotli) artifacts for all
 * text-based assets above 1KB in public/ and frontend/dist/.
 * 
 * When Nginx has `gzip_static on;` enabled, Nginx immediately serves these
 * pre-compressed files with zero CPU overhead on incoming requests.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.js',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.xml',
  '.txt',
  '.map'
]);

const MIN_SIZE_BYTES = 1024; // 1KB threshold per NFR-42

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...processDirectory(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      // Skip already-compressed archive files
      if (ext === '.gz' || ext === '.br') continue;

      if (COMPRESSIBLE_EXTENSIONS.has(ext)) {
        const stats = fs.statSync(fullPath);
        if (stats.size >= MIN_SIZE_BYTES) {
          const rawBuffer = fs.readFileSync(fullPath);

          // 1. Gzip (level 9 maximum compression for static assets)
          const gzBuffer = zlib.gzipSync(rawBuffer, { level: 9 });
          const gzPath = `${fullPath}.gz`;
          fs.writeFileSync(gzPath, gzBuffer);

          // 2. Brotli (quality 11 maximum compression for static assets)
          const brBuffer = zlib.brotliCompressSync(rawBuffer, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: rawBuffer.length,
            },
          });
          const brPath = `${fullPath}.br`;
          fs.writeFileSync(brPath, brBuffer);

          const gzSavings = ((1 - gzBuffer.length / rawBuffer.length) * 100).toFixed(1);
          const brSavings = ((1 - brBuffer.length / rawBuffer.length) * 100).toFixed(1);

          results.push({
            file: path.relative(process.cwd(), fullPath),
            rawSize: stats.size,
            gzSize: gzBuffer.length,
            brSize: brBuffer.length,
            gzSavings,
            brSavings,
          });
        }
      }
    }
  }

  return results;
}

function runPrecompression() {
  console.log('================================================================');
  console.log('🗜️  CollabIDE Precompression Utility (NFR-42: Gzip & Brotli)');
  console.log('================================================================\n');

  const targets = [
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, '../../frontend/dist'),
  ];

  let totalRaw = 0;
  let totalGz = 0;
  let totalBr = 0;
  let fileCount = 0;

  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.log(`ℹ️ Target directory not found, skipping: ${target}`);
      continue;
    }

    console.log(`📁 Scanning target directory: ${path.relative(process.cwd(), target)}`);
    const results = processDirectory(target);

    for (const r of results) {
      fileCount++;
      totalRaw += r.rawSize;
      totalGz += r.gzSize;
      totalBr += r.brSize;

      console.log(`  📄 ${r.file}`);
      console.log(`     Original: ${formatBytes(r.rawSize)}`);
      console.log(`     Gzip:     ${formatBytes(r.gzSize)} (-${r.gzSavings}%)`);
      console.log(`     Brotli:   ${formatBytes(r.brSize)} (-${r.brSavings}%)`);
    }
    console.log('');
  }

  if (fileCount > 0) {
    const totalGzSavings = ((1 - totalGz / totalRaw) * 100).toFixed(1);
    const totalBrSavings = ((1 - totalBr / totalRaw) * 100).toFixed(1);

    console.log('----------------------------------------------------------------');
    console.log(`📊 Summary: Precompressed ${fileCount} files (> 1KB threshold)`);
    console.log(`   Total Raw:    ${formatBytes(totalRaw)}`);
    console.log(`   Total Gzip:   ${formatBytes(totalGz)} (-${totalGzSavings}% reduction)`);
    console.log(`   Total Brotli: ${formatBytes(totalBr)} (-${totalBrSavings}% reduction)`);
    console.log('----------------------------------------------------------------\n');
  } else {
    console.log('ℹ️ No compressible files >= 1KB found.');
  }

  return { fileCount, totalRaw, totalGz, totalBr };
}

if (require.main === module) {
  runPrecompression();
}

module.exports = { runPrecompression };
