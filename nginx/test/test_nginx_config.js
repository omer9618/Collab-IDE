/**
 * ==============================================================================
 * CollabIDE - NFR-33 Reverse Proxy & Nginx Configuration Test Suite
 * ==============================================================================
 * Validates:
 * - NFR-33: TLS Termination, 301 Redirect, WebSocket Proxying, Static Serving, Rate Limiting
 * - NFR-34: Connection Rate Limiting at Network Layer (20r/s, burst=40, 200 conn, 429 status)
 * - NFR-34 Scope: Verifies WebSockets are strictly exempt from HTTP request throttling
 * - NFR-41: Static Asset Caching (immutable /assets/, no-cache /index.html)
 * - NFR-42: Gzip Compression (>1KB, level 6)
 * - NFR-07: WebSocket Timeout Protection (86400s timeouts, zero buffering)
 * - Certbot Contract: fullchain.pem / privkey.pem strict filenames
 * - Security: Dev-safe HSTS mapping, 25M client_max_body_size, zero baked certs in Dockerfile
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const NGINX_DIR = path.resolve(PROJECT_ROOT, 'nginx');
const CONF_D_DIR = path.resolve(NGINX_DIR, 'conf.d');
const TEMPLATES_DIR = path.resolve(NGINX_DIR, 'templates');
const SSL_DIR = path.resolve(NGINX_DIR, 'ssl');

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

console.log('================================================================');
console.log('🧪 Starting NFR-33 Nginx Reverse Proxy Validation Test Suite');
console.log('================================================================\n');

// ------------------------------------------------------------------------------
// Phase 1: File Existence & Hierarchy
// ------------------------------------------------------------------------------
console.log('📂 Phase 1: Verifying File & Directory Hierarchy...');
const nginxConfPath = path.join(NGINX_DIR, 'nginx.conf');
const collabideConfPath = path.join(CONF_D_DIR, 'collabide.conf');
const templateConfPath = path.join(TEMPLATES_DIR, 'collabide.conf.template');
const genCertsShPath = path.join(SSL_DIR, 'generate-certs.sh');
const genCertsPs1Path = path.join(SSL_DIR, 'generate-certs.ps1');
const dockerfilePath = path.join(NGINX_DIR, 'Dockerfile');
const composePath = path.join(PROJECT_ROOT, 'docker-compose.yml');

assert(fs.existsSync(nginxConfPath), 'nginx/nginx.conf exists');
assert(fs.existsSync(collabideConfPath), 'nginx/conf.d/collabide.conf exists');
assert(fs.existsSync(templateConfPath), 'nginx/templates/collabide.conf.template exists');
assert(fs.existsSync(genCertsShPath), 'nginx/ssl/generate-certs.sh exists');
assert(fs.existsSync(genCertsPs1Path), 'nginx/ssl/generate-certs.ps1 exists');
assert(fs.existsSync(dockerfilePath), 'nginx/Dockerfile exists');
assert(fs.existsSync(composePath), 'docker-compose.yml exists');

const nginxConf = fs.readFileSync(nginxConfPath, 'utf8');
const collabideConf = fs.readFileSync(collabideConfPath, 'utf8');
const templateConf = fs.readFileSync(templateConfPath, 'utf8');
const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
const compose = fs.readFileSync(composePath, 'utf8');

// ------------------------------------------------------------------------------
// Phase 2: TLS Termination & Certbot Contract (NFR-33)
// ------------------------------------------------------------------------------
console.log('\n🔒 Phase 2: Verifying TLS Termination & Certbot Contract...');
assert(collabideConf.includes('listen 443 ssl;'), 'Port 443 SSL listener configured');
assert(collabideConf.includes('/etc/nginx/ssl/fullchain.pem;'), 'Strict Certbot fullchain.pem contract configured');
assert(collabideConf.includes('/etc/nginx/ssl/privkey.pem;'), 'Strict Certbot privkey.pem contract configured');
assert(collabideConf.includes('TLSv1.2 TLSv1.3;'), 'Modern TLSv1.2 & TLSv1.3 protocols enforced');
assert(collabideConf.includes('ECDHE-ECDSA-AES128-GCM-SHA256'), 'High-security AEAD ciphers configured');
assert(collabideConf.includes('ssl_session_cache shared:SSL:10m;'), 'SSL session caching enabled for performance');
assert(collabideConf.includes('ssl_session_timeout 1d;'), 'SSL session timeout configured');

// ------------------------------------------------------------------------------
// Phase 3: HTTP to HTTPS Redirection (NFR-33)
// ------------------------------------------------------------------------------
console.log('\n🔀 Phase 3: Verifying HTTP to HTTPS Redirection (Port 80 -> 443)...');
assert(collabideConf.includes('listen 80;'), 'Port 80 HTTP listener configured');
assert(/return\s+301\s+https:\/\/\$host\$request_uri;/.test(collabideConf), 'HTTP 301 Permanent Redirect to HTTPS enforced');
assert(collabideConf.includes('/.well-known/acme-challenge/'), 'Certbot ACME challenge route supported without redirection');

// ------------------------------------------------------------------------------
// Phase 4: WebSocket Upgrade Proxying & Timeout Hardening (NFR-33 & NFR-07)
// ------------------------------------------------------------------------------
console.log('\n⚡ Phase 4: Verifying WebSocket Upgrade Proxying & Timeout Hardening...');
assert(/map\s+\$http_upgrade\s+\$connection_upgrade/.test(nginxConf), 'RFC 6455 $http_upgrade -> $connection_upgrade mapping configured');
assert(collabideConf.includes('location /ws/'), 'Dedicated /ws/ location for Yjs CRDT room synchronization exists');
assert(collabideConf.includes('location /socket.io/'), 'Dedicated /socket.io/ location for voice signalling exists');

// Verify WebSocket proxy headers on /ws/
const wsBlockMatch = collabideConf.match(/location\s+\/ws\/[\s\S]*?\{([\s\S]*?)\}/);
assert(wsBlockMatch !== null, 'Found /ws/ location block');
if (wsBlockMatch) {
  const wsBlock = wsBlockMatch[1];
  assert(wsBlock.includes('proxy_set_header Upgrade $http_upgrade;'), '/ws/ passes Upgrade header');
  assert(wsBlock.includes('proxy_set_header Connection $connection_upgrade;'), '/ws/ passes Connection header');
  assert(wsBlock.includes('proxy_read_timeout 86400s;'), '/ws/ has 24h proxy_read_timeout (prevents 60s disconnect)');
  assert(wsBlock.includes('proxy_send_timeout 86400s;'), '/ws/ has 24h proxy_send_timeout (prevents 60s disconnect)');
  assert(wsBlock.includes('proxy_buffering off;'), '/ws/ disables buffering for lowest latency keystroke sync');
  assert(!wsBlock.includes('limit_req'), '/ws/ is STRICTLY EXEMPT from HTTP limit_req rate limiting');
}

// Verify WebSocket proxy headers on /socket.io/
const socketIoBlockMatch = collabideConf.match(/location\s+\/socket\.io\/[\s\S]*?\{([\s\S]*?)\}/);
assert(socketIoBlockMatch !== null, 'Found /socket.io/ location block');
if (socketIoBlockMatch) {
  const ioBlock = socketIoBlockMatch[1];
  assert(ioBlock.includes('proxy_set_header Upgrade $http_upgrade;'), '/socket.io/ passes Upgrade header');
  assert(ioBlock.includes('proxy_set_header Connection $connection_upgrade;'), '/socket.io/ passes Connection header');
  assert(ioBlock.includes('proxy_read_timeout 86400s;'), '/socket.io/ has 24h proxy_read_timeout (prevents 60s voice drop)');
  assert(ioBlock.includes('proxy_send_timeout 86400s;'), '/socket.io/ has 24h proxy_send_timeout (prevents 60s voice drop)');
  assert(ioBlock.includes('proxy_buffering off;'), '/socket.io/ disables buffering for real-time audio chunk exchange');
  assert(!ioBlock.includes('limit_req'), '/socket.io/ is STRICTLY EXEMPT from HTTP limit_req rate limiting');
}

// ------------------------------------------------------------------------------
// Phase 5: Rate Limiting & Campus NAT Scoping (NFR-34)
// ------------------------------------------------------------------------------
console.log('\n🛡️  Phase 5: Verifying Connection Rate Limiting & Campus NAT Scoping...');
assert(/limit_req_zone\s+\$binary_remote_addr\s+zone=req_limit_per_ip:10m\s+rate=20r\/s;/.test(nginxConf), 'limit_req_zone defined at 20r/s per NFR-34');
assert(/limit_conn_zone\s+\$binary_remote_addr\s+zone=conn_limit_per_ip:10m;/.test(nginxConf), 'limit_conn_zone defined per NFR-34');
assert(nginxConf.includes('limit_req_status 429;'), 'HTTP 429 configured for request rate limit violations');
assert(nginxConf.includes('limit_conn_status 429;'), 'HTTP 429 configured for connection concurrency limit violations');

// Verify that limit_req is NOT placed at the 443 server root (prevents location inheritance trap)
const server443Block = collabideConf.match(/server\s*\{[\s\S]*?listen 443 ssl[\s\S]*?\n\}/);
if (server443Block) {
  const linesBeforeFirstLocation = collabideConf.slice(collabideConf.indexOf('listen 443 ssl'), collabideConf.indexOf('location /assets/'));
  assert(!linesBeforeFirstLocation.includes('limit_req zone='), 'Server 443 block does NOT declare global limit_req (avoids WS throttling)');
}

// Verify that limit_req IS placed on HTTP locations (/api/ and /)
const apiBlockMatch = collabideConf.match(/location\s+\/api\/[\s\S]*?\{([\s\S]*?)\}/);
assert(apiBlockMatch !== null && apiBlockMatch[1].includes('limit_req zone=req_limit_per_ip burst=40 nodelay;'), '/api/ applies limit_req with burst=40 for NAT resilience');
assert(apiBlockMatch !== null && apiBlockMatch[1].includes('limit_conn conn_limit_per_ip 200;'), '/api/ applies limit_conn 200 for multi-student labs');

// ------------------------------------------------------------------------------
// Phase 6: Static File Serving & Asset Caching (NFR-41)
// ------------------------------------------------------------------------------
console.log('\n📦 Phase 6: Verifying Static File Serving & Asset Caching...');
assert(collabideConf.includes('root /var/www/collabide/frontend/dist;'), 'Configured static root pointing to React dist');
assert(collabideConf.includes('Cache-Control "public, max-age=31536000, immutable"'), 'Versioned /assets/ configured with 1-year immutable caching');
assert(collabideConf.includes('Cache-Control "no-cache"'), '/index.html entry point configured with no-cache revalidation');
assert(collabideConf.includes('try_files $uri $uri/ /index.html;'), 'Client-side SPA routing fallback enabled');

// ------------------------------------------------------------------------------
// Phase 7: Gzip Compression (NFR-42)
// ------------------------------------------------------------------------------
console.log('\n🗜️  Phase 7: Verifying Gzip Compression...');
assert(nginxConf.includes('gzip on;'), 'Gzip compression enabled');
assert(nginxConf.includes('gzip_min_length 1024;'), 'Gzip minimum response length set to 1024 bytes (1KB)');
assert(nginxConf.includes('gzip_comp_level 6;'), 'Gzip compression level set to 6');
assert(nginxConf.includes('application/javascript'), 'Gzip configured for JavaScript bundles');
assert(nginxConf.includes('text/css'), 'Gzip configured for CSS stylesheets');
assert(nginxConf.includes('application/json'), 'Gzip configured for JSON responses');

// ------------------------------------------------------------------------------
// Phase 8: Security Hardening (Dev-Safe HSTS, 25MB Body, Container Isolation)
// ------------------------------------------------------------------------------
console.log('\n🔐 Phase 8: Verifying Security Hardening...');
assert(/map\s+\$host\s+\$hsts_header/.test(nginxConf), 'Dynamic $hsts_header map declared');
assert(nginxConf.includes('localhost "";'), 'HSTS suppressed on localhost to avoid browser cache poisoning');
assert(nginxConf.includes('127.0.0.1 "";'), 'HSTS suppressed on 127.0.0.1 to avoid browser cache poisoning');
assert(nginxConf.includes('client_max_body_size 25M;'), 'client_max_body_size set to 25M to prevent 413 Payload Too Large');

// Container security checks: Ensure certs are NOT copied into Dockerfile layers
assert(!dockerfile.includes('COPY nginx/ssl') && !dockerfile.includes('COPY ./nginx/ssl'), 'Dockerfile does NOT copy certificates into image layers');
assert(compose.includes('./nginx/ssl:/etc/nginx/ssl:ro'), 'docker-compose.yml mounts SSL certs via read-only volume');

// ------------------------------------------------------------------------------
// Phase 9: Frontend & Backend Source Sync
// ------------------------------------------------------------------------------
console.log('\n🔄 Phase 9: Verifying Frontend & Backend Code Sync...');
const workspaceView = fs.readFileSync(path.join(PROJECT_ROOT, 'frontend/src/components/WorkspaceView.jsx'), 'utf8');
const serverJs = fs.readFileSync(path.join(PROJECT_ROOT, 'collab-ide/server.js'), 'utf8');

assert(workspaceView.includes('${window.location.protocol === \'https:\' ? \'wss:\' : \'ws:\'}//${window.location.host}/ws'), 'WorkspaceView routes WebSocket via Nginx origin and /ws prefix');
assert(workspaceView.includes('window.location.port === \'5173\''), 'WorkspaceView retains direct port 5173 fallback for Vite dev');
assert(serverJs.includes('replace(/^\\/ws\\/?/, \'/\')'), 'server.js upgrade handler supports optional /ws/ prefix');

// ------------------------------------------------------------------------------
// Phase 10: Real Syntax & Configuration Validation via nginx -t
// ------------------------------------------------------------------------------
console.log('\n🔍 Phase 10: Executing Real nginx -t Configuration Validation...');
let nginxTestOutput = '';
let nginxSuccess = false;

try {
  // Test via WSL Nginx binary (full stack test with configs and SSL certs)
  const wslTestCmd = `wsl -u root -- bash -c "mkdir -p /etc/nginx/ssl && cp ${SSL_DIR.replace(/\\/g, '/').replace('C:', '/mnt/c')}/*.pem /etc/nginx/ssl/ && mkdir -p /var/www/collabide/frontend/dist && mkdir -p /var/www/certbot && cp ${CONF_D_DIR.replace(/\\/g, '/').replace('C:', '/mnt/c')}/collabide.conf /etc/nginx/conf.d/ && cp ${nginxConfPath.replace(/\\/g, '/').replace('C:', '/mnt/c')} /etc/nginx/nginx.conf && nginx -t 2>&1"`;
  nginxTestOutput = execSync(wslTestCmd, { encoding: 'utf8' });
  if (nginxTestOutput.includes('syntax is ok') && nginxTestOutput.includes('test is successful')) {
    nginxSuccess = true;
  }
} catch (wslErr) {
  // Try Docker fallback
  try {
    const dockerTestCmd = `docker run --rm -v "${NGINX_DIR}:/etc/nginx:ro" nginx:alpine nginx -t`;
    nginxTestOutput = execSync(dockerTestCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (nginxTestOutput.includes('syntax is ok') && nginxTestOutput.includes('test is successful')) {
      nginxSuccess = true;
    }
  } catch (dockerErr) {
    nginxTestOutput = wslErr.stderr || wslErr.message || dockerErr.stderr || dockerErr.message;
  }
}

assert(nginxSuccess, `Real nginx -t binary syntax validation (Output: ${nginxTestOutput.trim().replace(/\n/g, ' ')})`);


// ------------------------------------------------------------------------------
// Test Summary
// ------------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log('================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL NFR-33 REVERSE PROXY REQUIREMENTS SATISFIED SUCCESSFULLY!\n');
  process.exit(0);
}
