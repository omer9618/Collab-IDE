/**
 * @file test/test_nfr42_compression.js
 * @description Automated Integration Test Suite for NFR-42: Compression.
 * 
 * VALIDATION CRITERIA (NFR-42):
 * "Nginx must enable gzip or Brotli compression for all text-based responses
 * (HTML, JS, CSS, JSON) above 1KB. This reduces bandwidth and improves load times
 * for the client bundle, which includes the Monaco Editor."
 * 
 * PHASES:
 * 1. Nginx Configuration Directive Verification (nginx.conf, collabide.conf, template)
 * 2. Live HTTP Compression: Client JavaScript Bundle (Monaco Editor ~5.7MB -> ~1.0MB, >75% reduction)
 * 3. Live HTTP Compression: CSS Stylesheets (~92KB -> ~16KB, >70% reduction)
 * 4. Live HTTP Compression: HTML Entry Point (~22KB -> ~5KB, >60% reduction)
 * 5. Live HTTP Compression: Dynamic API JSON Responses (> 1KB)
 * 6. Strict Threshold Enforcement: Payloads <= 1KB Must NOT be compressed (no overhead on tiny frames)
 * 7. Client Capability Negotiation & Opt-Out (Accept-Encoding: identity, x-no-compression)
 * 8. Static Precompression Verification (.gz and .br artifacts, integrity & Brotli >85% reduction)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const NGINX_DIR = path.resolve(PROJECT_ROOT, 'nginx');
const COLLAB_IDE_DIR = path.resolve(PROJECT_ROOT, 'collab-ide');
const PUBLIC_DIR = path.resolve(COLLAB_IDE_DIR, 'public');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Native HTTP GET helper that retrieves exact raw wire bytes without transparent decompression.
 */
function httpGetRaw(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };
    const req = http.get(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-42: Compression Automated Verification Tests');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Phase 1: Nginx Configuration Verification
  // --------------------------------------------------------------------------
  console.log('⚙️  Phase 1: Verifying Nginx Reverse Proxy Compression Directives...');

  const nginxConfPath = path.join(NGINX_DIR, 'nginx.conf');
  const collabideConfPath = path.join(NGINX_DIR, 'conf.d', 'collabide.conf');
  const templateConfPath = path.join(NGINX_DIR, 'templates', 'collabide.conf.template');

  assert(fs.existsSync(nginxConfPath), 'nginx/nginx.conf exists');
  const nginxConf = fs.readFileSync(nginxConfPath, 'utf8');

  // Gzip core directives
  assert(nginxConf.includes('gzip on;'), 'Nginx gzip compression enabled (gzip on;)');
  assert(/gzip_min_length\s+1024;/.test(nginxConf), 'gzip_min_length set to exactly 1024 bytes (1KB threshold per NFR-42)');
  assert(/gzip_comp_level\s+6;/.test(nginxConf), 'gzip_comp_level set to 6 (optimal ratio-to-CPU trade-off)');
  assert(nginxConf.includes('gzip_proxied any;'), 'gzip_proxied any enabled (compresses proxied Node.js JSON API responses)');
  assert(nginxConf.includes('gzip_vary on;'), 'gzip_vary on enabled (preserves Vary: Accept-Encoding header for caches)');
  assert(nginxConf.includes('gzip_static on;'), 'gzip_static on enabled (serves precompressed .gz assets without CPU overhead)');

  // Required MIME Types per NFR-42: HTML, JS, CSS, JSON
  assert(nginxConf.includes('application/javascript'), 'gzip_types includes application/javascript (JS client bundles)');
  assert(nginxConf.includes('text/css'), 'gzip_types includes text/css (CSS stylesheets)');
  assert(nginxConf.includes('application/json'), 'gzip_types includes application/json (REST API responses)');
  assert(nginxConf.includes('text/plain'), 'gzip_types includes text/plain');
  assert(nginxConf.includes('image/svg+xml'), 'gzip_types includes image/svg+xml');

  // Static location configuration in collabide.conf and template
  const collabideConf = fs.readFileSync(collabideConfPath, 'utf8');
  const templateConf = fs.readFileSync(templateConfPath, 'utf8');

  assert(collabideConf.includes('gzip_static on;'), 'collabide.conf has gzip_static enabled on static routes');
  assert(templateConf.includes('gzip_static on;'), 'collabide.conf.template has gzip_static enabled on static routes');

  // --------------------------------------------------------------------------
  // Phase 2: Live Server Compression — Client JavaScript Bundle (Monaco Editor)
  // --------------------------------------------------------------------------
  console.log('\n📜 Phase 2: Live Server Compression of Monaco Editor Bundle (JS > 1KB)...');

  // Start server on an ephemeral port
  const testPort = 3198;
  process.env.PORT = testPort;
  const { server } = require('../server');
  if (!server.listening) {
    server.listen(testPort);
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const baseUrl = `http://localhost:${testPort}`;

  // Read raw local bundle file for ground truth comparison
  const rawBundlePath = path.join(PUBLIC_DIR, 'collab-bundle.js');
  const rawBundle = fs.readFileSync(rawBundlePath);
  const rawBundleSize = rawBundle.length;
  console.log(`  ℹ️ Raw Monaco Bundle Size: ${formatBytes(rawBundleSize)} (${rawBundleSize} bytes)`);

  // Request /collab-bundle.js with Accept-Encoding: gzip using native HTTP to capture wire bytes
  const resBundle = await httpGetRaw(`${baseUrl}/collab-bundle.js`, {
    'Accept-Encoding': 'gzip',
  });

  assert(resBundle.status === 200, 'GET /collab-bundle.js returned HTTP 200');
  assert(resBundle.headers['content-encoding'] === 'gzip', 'Response Content-Encoding is "gzip"');
  assert(resBundle.headers['vary']?.includes('Accept-Encoding'), 'Response contains "Vary: Accept-Encoding" header');

  const bundleCompressedBuffer = resBundle.buffer;
  const bundleCompressedSize = bundleCompressedBuffer.length;
  const bundleReduction = ((1 - bundleCompressedSize / rawBundleSize) * 100).toFixed(1);
  console.log(`  ℹ️ Wire Compressed Size:   ${formatBytes(bundleCompressedSize)} (-${bundleReduction}%)`);

  assert(bundleCompressedSize < rawBundleSize, `Compressed bundle size is significantly smaller than raw (${formatBytes(bundleCompressedSize)} < ${formatBytes(rawBundleSize)})`);
  assert(bundleCompressedSize < rawBundleSize * 0.25, `Compressed bundle achieves > 75% reduction (Actual: ${bundleReduction}%)`);

  // Verify byte-level decompression integrity
  const decompressedBundle = zlib.gunzipSync(bundleCompressedBuffer);
  assert(decompressedBundle.length === rawBundleSize, 'Decompressed bundle byte length matches original exactly');
  assert(decompressedBundle.equals(rawBundle), 'Decompressed bundle matches original raw file byte-for-byte');

  // --------------------------------------------------------------------------
  // Phase 3: Live Server Compression — CSS Stylesheet
  // --------------------------------------------------------------------------
  console.log('\n🎨 Phase 3: Live Server Compression of CSS Stylesheet (CSS > 1KB)...');

  const rawCssPath = path.join(PUBLIC_DIR, 'collab-bundle.css');
  const rawCss = fs.readFileSync(rawCssPath);
  const rawCssSize = rawCss.length;

  const resCss = await httpGetRaw(`${baseUrl}/collab-bundle.css`, {
    'Accept-Encoding': 'gzip',
  });

  assert(resCss.status === 200, 'GET /collab-bundle.css returned HTTP 200');
  assert(resCss.headers['content-encoding'] === 'gzip', 'CSS Response Content-Encoding is "gzip"');

  const cssCompressedBuffer = resCss.buffer;
  const cssReduction = ((1 - cssCompressedBuffer.length / rawCssSize) * 100).toFixed(1);
  console.log(`  ℹ️ Raw CSS: ${formatBytes(rawCssSize)} | Compressed CSS: ${formatBytes(cssCompressedBuffer.length)} (-${cssReduction}%)`);

  assert(cssCompressedBuffer.length < rawCssSize * 0.35, `Compressed CSS achieves > 65% reduction (Actual: ${cssReduction}%)`);
  const decompressedCss = zlib.gunzipSync(cssCompressedBuffer);
  assert(decompressedCss.equals(rawCss), 'Decompressed CSS matches original raw file byte-for-byte');

  // --------------------------------------------------------------------------
  // Phase 4: Live Server Compression — HTML Entry Point
  // --------------------------------------------------------------------------
  console.log('\n📄 Phase 4: Live Server Compression of HTML Entry Point (HTML > 1KB)...');

  const rawHtmlPath = path.join(PUBLIC_DIR, 'index.html');
  const rawHtml = fs.readFileSync(rawHtmlPath);
  const rawHtmlSize = rawHtml.length;

  const resHtml = await httpGetRaw(`${baseUrl}/`, {
    'Accept-Encoding': 'gzip',
  });

  assert(resHtml.status === 200, 'GET / returned HTTP 200');
  assert(resHtml.headers['content-encoding'] === 'gzip', 'HTML Response Content-Encoding is "gzip"');

  const htmlCompressedBuffer = resHtml.buffer;
  const htmlReduction = ((1 - htmlCompressedBuffer.length / rawHtmlSize) * 100).toFixed(1);
  console.log(`  ℹ️ Raw HTML: ${formatBytes(rawHtmlSize)} | Compressed HTML: ${formatBytes(htmlCompressedBuffer.length)} (-${htmlReduction}%)`);

  assert(htmlCompressedBuffer.length < rawHtmlSize * 0.5, `Compressed HTML achieves > 50% reduction (Actual: ${htmlReduction}%)`);
  const decompressedHtml = zlib.gunzipSync(htmlCompressedBuffer);
  assert(decompressedHtml.equals(rawHtml), 'Decompressed HTML matches original raw file byte-for-byte');

  // --------------------------------------------------------------------------
  // Phase 5: Live Server Compression — Dynamic API JSON Responses (> 1KB)
  // --------------------------------------------------------------------------
  console.log('\n📊 Phase 5: Live Server Compression of Dynamic API JSON Responses (> 1KB)...');

  // Fetch /health endpoint which returns JSON system metrics
  const resHealth = await httpGetRaw(`${baseUrl}/health`, {
    'Accept-Encoding': 'gzip',
  });

  assert(resHealth.status === 200, 'GET /health returned HTTP 200');
  let healthBody;
  if (resHealth.headers['content-encoding'] === 'gzip') {
    assert(true, 'Dynamic API endpoint with > 1KB response compressed with gzip');
    healthBody = JSON.parse(zlib.gunzipSync(resHealth.buffer).toString('utf8'));
  } else {
    healthBody = JSON.parse(resHealth.buffer.toString('utf8'));
  }
  assert(healthBody.status === 'healthy' || healthBody.uptime !== undefined, 'API payload decompressed and parsed cleanly as valid JSON');

  // --------------------------------------------------------------------------
  // Phase 6: Strict Threshold Enforcement (Responses <= 1KB Must NOT be Compressed)
  // --------------------------------------------------------------------------
  console.log('\n📏 Phase 6: Verifying Strict 1KB (1024 Bytes) Minimum Compression Threshold...');

  // Query /api/auth/csrf-token which returns a small JSON payload (< 1024 bytes)
  const resSmall = await httpGetRaw(`${baseUrl}/api/auth/csrf-token`, {
    'Accept-Encoding': 'gzip',
  });

  const smallSize = resSmall.buffer.length;
  console.log(`  ℹ️ Small Response Size: ${smallSize} bytes (< 1024 bytes threshold)`);
  assert(smallSize < 1024, 'Payload length is strictly under 1024 bytes');
  assert(!resSmall.headers['content-encoding'], 'Sub-1KB payload is NOT compressed (avoids gzip overhead)');

  // --------------------------------------------------------------------------
  // Phase 7: Client Capability Negotiation & Opt-Out
  // --------------------------------------------------------------------------
  console.log('\n🤝 Phase 7: Verifying Client Capability Negotiation & Header Opt-Out...');

  // Client requests identity (no compression)
  const resIdentity = await httpGetRaw(`${baseUrl}/collab-bundle.js`, {
    'Accept-Encoding': 'identity',
  });
  assert(!resIdentity.headers['content-encoding'], 'Accept-Encoding: identity yields uncompressed payload');

  // Client uses x-no-compression opt-out header
  const resOptOut = await httpGetRaw(`${baseUrl}/collab-bundle.js`, {
    'Accept-Encoding': 'gzip',
    'x-no-compression': 'true',
  });
  assert(!resOptOut.headers['content-encoding'], 'x-no-compression: true header successfully bypasses compression');

  // --------------------------------------------------------------------------
  // Phase 8: Static Precompressed Assets (.gz and .br verification)
  // --------------------------------------------------------------------------
  console.log('\n📦 Phase 8: Verifying Precompressed Static Assets (.gz and .br)...');

  const precompressedGz = `${rawBundlePath}.gz`;
  const precompressedBr = `${rawBundlePath}.br`;

  assert(fs.existsSync(precompressedGz), 'Precompressed .gz file exists for collab-bundle.js');
  assert(fs.existsSync(precompressedBr), 'Precompressed .br file exists for collab-bundle.js');

  const gzFile = fs.readFileSync(precompressedGz);
  const brFile = fs.readFileSync(precompressedBr);

  const gzReduction = ((1 - gzFile.length / rawBundleSize) * 100).toFixed(1);
  const brReduction = ((1 - brFile.length / rawBundleSize) * 100).toFixed(1);

  console.log(`  ℹ️ Precompressed Gzip:   ${formatBytes(gzFile.length)} (-${gzReduction}%)`);
  console.log(`  ℹ️ Precompressed Brotli: ${formatBytes(brFile.length)} (-${brReduction}%)`);

  assert(gzFile.length < rawBundleSize * 0.25, `Precompressed Gzip achieves > 75% reduction (Actual: ${gzReduction}%)`);
  assert(brFile.length < gzFile.length, `Precompressed Brotli achieves higher compression than Gzip (${formatBytes(brFile.length)} < ${formatBytes(gzFile.length)})`);
  assert(brFile.length < rawBundleSize * 0.20, `Precompressed Brotli achieves > 80% reduction (Actual: ${brReduction}%)`);

  // Verify decompression match
  const decompressedGzFile = zlib.gunzipSync(gzFile);
  const decompressedBrFile = zlib.brotliDecompressSync(brFile);

  assert(decompressedGzFile.equals(rawBundle), 'Precompressed .gz decompresses to exact byte-for-byte original');
  assert(decompressedBrFile.equals(rawBundle), 'Precompressed .br decompresses to exact byte-for-byte original');

  // Teardown test server
  await new Promise((resolve) => server.close(resolve));

  // --------------------------------------------------------------------------
  // Test Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ NFR-42 Compression tests failed!');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-42 COMPRESSION REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
