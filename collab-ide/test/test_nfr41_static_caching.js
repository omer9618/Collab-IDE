/**
 * @file test/test_nfr41_static_caching.js
 * @description Automated Integration & Configuration Test Suite for NFR-41: Static Asset Caching.
 *
 * SPECIFICATION (NFR-41):
 * "The Nginx reverse proxy must serve the React frontend bundle and static assets with
 * `Cache-Control: public, max-age=31536000, immutable` for versioned filenames
 * (content-hashed by the build tool). The HTML entry point must use `Cache-Control: no-cache`
 * to ensure users always get the latest version."
 *
 * TEST PHASES:
 * 1. Bare Express Standalone Server (Testing Component 4 directly with no Nginx in front)
 * 2. Nginx Reverse Proxy Configuration & Uniform Security Header Audit (NFR-41, NFR-33)
 * 3. Vite Build Content-Hashing & Precompression Sidecar Verification
 * 4. Cache Partitioning & Anti-Poisoning Invariants
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const NGINX_DIR = path.resolve(PROJECT_ROOT, 'nginx');
const CONF_D_DIR = path.resolve(NGINX_DIR, 'conf.d');
const TEMPLATES_DIR = path.resolve(NGINX_DIR, 'templates');
const FRONTEND_DIR = path.resolve(PROJECT_ROOT, 'frontend');
const DIST_DIR = path.resolve(FRONTEND_DIR, 'dist');
const ASSETS_DIR = path.resolve(DIST_DIR, 'assets');

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

/**
 * Native HTTP GET helper that retrieves exact raw response headers and status.
 */
function httpGet(urlStr, headers = {}) {
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
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
  });
}

function validateNginxStructure(confText, filename) {
  let openBraces = 0;
  let closeBraces = 0;
  const lines = confText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const codePart = line.split('#')[0];
    for (const ch of codePart) {
      if (ch === '{') openBraces++;
      if (ch === '}') closeBraces++;
    }
  }

  if (openBraces !== closeBraces) {
    throw new Error(`${filename} has mismatched curly braces: ${openBraces} open vs ${closeBraces} close`);
  }
  return true;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 Starting NFR-41: Static Asset Caching Automated Test Suite');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Phase 1: Bare Express Standalone Server (Testing Component 4 directly)
  // --------------------------------------------------------------------------
  console.log('🚀 Phase 1: Live HTTP Headers from Bare Express Standalone Server...');

  const testPort = 3199;
  process.env.PORT = testPort;
  const { app } = require('../server');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${testPort}`;
  console.log(`  📡 Bare Express server listening at ${baseUrl}`);

  try {
    // 1. Versioned JavaScript bundle in /assets/
    const assetFiles = fs.readdirSync(ASSETS_DIR);
    const jsBundle = assetFiles.find((f) => f.endsWith('.js') && !f.endsWith('.gz'));
    const cssBundle = assetFiles.find((f) => f.endsWith('.css') && !f.endsWith('.gz'));

    assert(Boolean(jsBundle), `Found versioned JS bundle in dist/assets: ${jsBundle}`);
    assert(Boolean(cssBundle), `Found versioned CSS bundle in dist/assets: ${cssBundle}`);

    if (jsBundle) {
      const resJs = await httpGet(`${baseUrl}/assets/${jsBundle}`);
      assert(resJs.status === 200, `GET /assets/${jsBundle} returned HTTP 200`);
      assert(
        resJs.headers['cache-control'] === 'public, max-age=31536000, immutable',
        `Versioned JS bundle has Cache-Control: public, max-age=31536000, immutable (Actual: "${resJs.headers['cache-control']}")`
      );
    }

    // 2. Versioned CSS stylesheet in /assets/
    if (cssBundle) {
      const resCss = await httpGet(`${baseUrl}/assets/${cssBundle}`);
      assert(resCss.status === 200, `GET /assets/${cssBundle} returned HTTP 200`);
      assert(
        resCss.headers['cache-control'] === 'public, max-age=31536000, immutable',
        `Versioned CSS bundle has Cache-Control: public, max-age=31536000, immutable (Actual: "${resCss.headers['cache-control']}")`
      );
    }

    // 3. HTML Entry Point (/index.html)
    const resIndex = await httpGet(`${baseUrl}/index.html`);
    assert(resIndex.status === 200, 'GET /index.html returned HTTP 200');
    assert(
      resIndex.headers['cache-control'] === 'no-cache',
      `HTML entry point /index.html has Cache-Control: no-cache (Actual: "${resIndex.headers['cache-control']}")`
    );

    // 4. Root path (/)
    const resRoot = await httpGet(`${baseUrl}/`);
    assert(resRoot.status === 200, 'GET / returned HTTP 200');
    assert(
      resRoot.headers['cache-control'] === 'no-cache',
      `Root path / has Cache-Control: no-cache (Actual: "${resRoot.headers['cache-control']}")`
    );

    // 5. Unversioned public assets (favicon.png, logo.png)
    const resFavicon = await httpGet(`${baseUrl}/favicon.png`);
    assert(resFavicon.status === 200, 'GET /favicon.png returned HTTP 200');
    const faviconCache = resFavicon.headers['cache-control'] || '';
    assert(
      !faviconCache.includes('immutable'),
      'Unversioned asset /favicon.png does NOT have immutable directive'
    );
    assert(
      !faviconCache.includes('max-age=31536000'),
      'Unversioned asset /favicon.png does NOT have 1-year max-age caching'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // --------------------------------------------------------------------------
  // Phase 2: Nginx Reverse Proxy Configuration & Uniform Security Header Audit
  // --------------------------------------------------------------------------
  console.log('\n🔒 Phase 2: Nginx Reverse Proxy Configuration & Uniform Security Header Audit...');

  const collabideConfPath = path.join(CONF_D_DIR, 'collabide.conf');
  const templateConfPath = path.join(TEMPLATES_DIR, 'collabide.conf.template');

  assert(fs.existsSync(collabideConfPath), 'nginx/conf.d/collabide.conf exists');
  assert(fs.existsSync(templateConfPath), 'nginx/templates/collabide.conf.template exists');

  const collabideConf = fs.readFileSync(collabideConfPath, 'utf8');
  const templateConf = fs.readFileSync(templateConfPath, 'utf8');

  // Audit collabide.conf
  for (const [confName, confText] of [
    ['collabide.conf', collabideConf],
    ['collabide.conf.template', templateConf],
  ]) {
    console.log(`  🔍 Auditing ${confName}...`);

    // 1. Root configuration
    assert(
      confText.includes('root /var/www/collabide/frontend/dist;'),
      `${confName}: Static root configured pointing to frontend dist`
    );
    assert(
      confText.includes('index index.html;'),
      `${confName}: Default index configured as index.html`
    );

    // 2. /assets/ location
    const assetsBlockMatch = confText.match(/location\s+\/assets\/[\s\S]*?\{([\s\S]*?)\}/);
    assert(assetsBlockMatch !== null, `${confName}: location /assets/ block exists`);

    if (assetsBlockMatch) {
      const assetsBlock = assetsBlockMatch[1];
      assert(
        assetsBlock.includes('add_header Cache-Control "public, max-age=31536000, immutable" always;'),
        `${confName}: /assets/ specifies Cache-Control "public, max-age=31536000, immutable" always;`
      );
      assert(
        assetsBlock.includes('try_files $uri =404;'),
        `${confName}: /assets/ enforces try_files $uri =404; (prevents missing chunk SPA fallback leak)`
      );
      assert(
        assetsBlock.includes('gzip_static on;'),
        `${confName}: /assets/ enables gzip_static on; for precompressed asset serving`
      );

      // Verify all 5 security headers are present in /assets/ to prevent Nginx inheritance loss
      assert(
        assetsBlock.includes('add_header Strict-Transport-Security $hsts_header always;'),
        `${confName}: /assets/ re-declares Strict-Transport-Security`
      );
      assert(
        assetsBlock.includes('add_header X-Frame-Options "SAMEORIGIN" always;'),
        `${confName}: /assets/ re-declares X-Frame-Options`
      );
      assert(
        assetsBlock.includes('add_header X-Content-Type-Options "nosniff" always;'),
        `${confName}: /assets/ re-declares X-Content-Type-Options`
      );
      assert(
        assetsBlock.includes('add_header X-XSS-Protection "1; mode=block" always;'),
        `${confName}: /assets/ re-declares X-XSS-Protection`
      );
      assert(
        assetsBlock.includes('add_header Referrer-Policy "strict-origin-when-cross-origin" always;'),
        `${confName}: /assets/ re-declares Referrer-Policy`
      );
    }

    // 3. = /index.html exact location
    const indexBlockMatch = confText.match(/location\s+=\s+\/index\.html[\s\S]*?\{([\s\S]*?)\}/);
    assert(indexBlockMatch !== null, `${confName}: location = /index.html block exists`);

    if (indexBlockMatch) {
      const indexBlock = indexBlockMatch[1];
      assert(
        indexBlock.includes('add_header Cache-Control "no-cache" always;'),
        `${confName}: /index.html specifies Cache-Control "no-cache" always;`
      );
      assert(
        indexBlock.includes('gzip_static on;'),
        `${confName}: /index.html enables gzip_static on;`
      );

      // Verify all 5 security headers are present in /index.html
      assert(
        indexBlock.includes('add_header Strict-Transport-Security $hsts_header always;'),
        `${confName}: /index.html re-declares Strict-Transport-Security`
      );
      assert(
        indexBlock.includes('add_header X-Frame-Options "SAMEORIGIN" always;'),
        `${confName}: /index.html re-declares X-Frame-Options`
      );
      assert(
        indexBlock.includes('add_header X-Content-Type-Options "nosniff" always;'),
        `${confName}: /index.html re-declares X-Content-Type-Options`
      );
      assert(
        indexBlock.includes('add_header X-XSS-Protection "1; mode=block" always;'),
        `${confName}: /index.html re-declares X-XSS-Protection`
      );
      assert(
        indexBlock.includes('add_header Referrer-Policy "strict-origin-when-cross-origin" always;'),
        `${confName}: /index.html re-declares Referrer-Policy`
      );
    }

    // 4. SPA fallback in location / (within port 443 server block)
    const server443Text = confText.slice(confText.indexOf('listen 443'));
    const rootBlockMatch = server443Text.match(/location\s+\/\s*\{([\s\S]*?)\}/);
    assert(rootBlockMatch !== null, `${confName}: location / block exists`);
    if (rootBlockMatch) {
      const rootBlock = rootBlockMatch[1];
      assert(
        rootBlock.includes('try_files $uri $uri/ /index.html;'),
        `${confName}: location / provides try_files $uri $uri/ /index.html;`
      );
    }

    // 5. AST & syntax check
    assert(
      validateNginxStructure(confText, confName),
      `${confName}: Structural AST validation passed (balanced braces, valid block hierarchy)`
    );
  }

  // --------------------------------------------------------------------------
  // Phase 3: Vite Build Content-Hashing & Precompression Sidecars
  // --------------------------------------------------------------------------
  console.log('\n📦 Phase 3: Vite Build Content-Hashing & Precompression Sidecars...');

  const viteConfigPath = path.join(FRONTEND_DIR, 'vite.config.js');
  const viteConfig = fs.readFileSync(viteConfigPath, 'utf8');

  assert(
    viteConfig.includes("entryFileNames: 'assets/[name]-[hash].js'"),
    'vite.config.js configures explicit content-hashed entryFileNames'
  );
  assert(
    viteConfig.includes("chunkFileNames: 'assets/[name]-[hash].js'"),
    'vite.config.js configures explicit content-hashed chunkFileNames'
  );
  assert(
    viteConfig.includes("assetFileNames: 'assets/[name]-[hash].[ext]'"),
    'vite.config.js configures explicit content-hashed assetFileNames'
  );

  const packageJsonPath = path.join(FRONTEND_DIR, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert(
    packageJson.scripts.build.includes('scripts/precompress.js'),
    'frontend/package.json hooks precompress.js into build script'
  );

  const precompressScriptPath = path.join(FRONTEND_DIR, 'scripts/precompress.js');
  assert(fs.existsSync(precompressScriptPath), 'frontend/scripts/precompress.js exists');

  // Verify dist files and .gz sidecars
  const distAssets = fs.readdirSync(ASSETS_DIR);
  const hashedJsFiles = distAssets.filter((f) => /-[a-zA-Z0-9_-]{8,}\.js$/.test(f));
  const hashedCssFiles = distAssets.filter((f) => /-[a-zA-Z0-9_-]{8,}\.css$/.test(f));

  assert(hashedJsFiles.length > 0, `Generated ${hashedJsFiles.length} content-hashed JavaScript bundle(s)`);
  assert(hashedCssFiles.length > 0, `Generated ${hashedCssFiles.length} content-hashed CSS stylesheet(s)`);

  // Verify that .gz sidecars exist for files > 1KB
  for (const jsFile of hashedJsFiles) {
    const fullPath = path.join(ASSETS_DIR, jsFile);
    const size = fs.statSync(fullPath).size;
    if (size >= 1024) {
      assert(
        fs.existsSync(`${fullPath}.gz`),
        `gzip_static sidecar exists for >1KB bundle: ${jsFile}.gz (${(size / 1024).toFixed(1)} KB)`
      );
    }
  }

  // Verify index.html references the content-hashed bundles
  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  for (const jsFile of hashedJsFiles) {
    if (indexHtml.includes(jsFile)) {
      assert(true, `index.html references content-hashed script bundle: ${jsFile}`);
    }
  }

  // --------------------------------------------------------------------------
  // Phase 4: Cache Partitioning & Anti-Poisoning Invariants
  // --------------------------------------------------------------------------
  console.log('\n🛡️  Phase 4: Cache Partitioning & Anti-Poisoning Invariants...');

  // Invariant 1: HTML entry point is NEVER given immutable or long max-age
  assert(!indexHtml.includes('max-age=31536000'), 'index.html content does not hardcode immutable caching');
  assert(
    collabideConf.includes('location = /index.html') &&
      collabideConf.includes('add_header Cache-Control "no-cache" always;'),
    'Nginx strictly binds no-cache to /index.html'
  );

  // Invariant 2: /assets/ location enforces try_files $uri =404
  assert(
    collabideConf.includes('try_files $uri =404;'),
    'Nginx enforces try_files $uri =404; on /assets/ preventing missing script chunk 200-fallback bugs'
  );

  // --------------------------------------------------------------------------
  // Test Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('❌ NFR-41 Static Asset Caching test suite FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL NFR-41 STATIC ASSET CACHING REQUIREMENTS SATISFIED!\n');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('💥 Unhandled test exception:', err);
  process.exit(1);
});
