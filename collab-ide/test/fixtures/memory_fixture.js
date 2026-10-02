/**
 * @file test/fixtures/memory_fixture.js
 * Test fixture for verifying PM2 memory threshold auto-restart.
 */
const http = require('http');

let leak = [];

const server = http.createServer((req, res) => {
  if (req.url === '/allocate') {
    // Allocate ~60MB into global memory array to exceed memory threshold
    for (let i = 0; i < 60; i++) {
      leak.push(Buffer.alloc(1024 * 1024, 'x'));
    }
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ allocatedMb: leak.length, rssMb: Math.round(mem.rss / 1024 / 1024) }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ pid: process.pid, memMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }));
});

server.listen(0, () => {
  if (process.send) {
    process.send('ready');
  }
});
