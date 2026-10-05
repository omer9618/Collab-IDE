/**
 * @file test/fixtures/worker_fixture.js
 * Lightweight cluster worker test fixture for PM2 integration tests.
 */
const http = require('http');

const PORT = process.env.TEST_PORT || 3987;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    pid: process.pid,
    uptime: process.uptime()
  }));
});

server.listen(PORT, () => {
  if (process.send) {
    process.send('ready');
  }
});
