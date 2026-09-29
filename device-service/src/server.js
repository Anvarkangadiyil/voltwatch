'use strict';

// Zero-dependency device service: REST API, WebSocket telemetry push, and
// static hosting for the web dashboard. Kept dependency-free so it runs on a
// small embedded Linux image with nothing but a Node runtime.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { UpsSimulator } = require('./simulator');
const { acceptUpgrade, encodeTextFrame, decodeFrames } = require('./websocket');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const MAX_BODY_BYTES = 4 * 1024;

function createServer({ simulator = new UpsSimulator() } = {}) {
  const clients = new Set();
  let latest = simulator.tick();

  const broadcast = (message) => {
    const frame = encodeTextFrame(JSON.stringify(message));
    for (const socket of clients) socket.write(frame);
  };

  simulator.on('telemetry', (t) => {
    latest = t;
    broadcast({ type: 'telemetry', data: t });
  });
  simulator.on('config', (c) => broadcast({ type: 'config', data: c }));

  const sendJson = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error('body too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
        }
      });
    });

  const routes = {
    'GET /api/health': (req, res) => sendJson(res, 200, { ok: true, uptimeSeconds: Math.round(process.uptime()), clients: clients.size }),
    'GET /api/status': (req, res) => sendJson(res, 200, latest),
    'GET /api/config': (req, res) => sendJson(res, 200, simulator.config),
    'PUT /api/config': async (req, res) => {
      const result = simulator.updateConfig(await readJson(req));
      result.ok ? sendJson(res, 200, result.config) : sendJson(res, 422, { errors: result.errors });
    },
    'POST /api/actions/self-test': (req, res) =>
      simulator.startSelfTest() ? sendJson(res, 202, { started: true }) : sendJson(res, 409, { error: 'self-test already running' }),
    'POST /api/actions/simulate-outage': async (req, res) => {
      const { seconds = 20 } = await readJson(req);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
        return sendJson(res, 422, { errors: ['seconds: must be an integer 1-600'] });
      }
      simulator.simulateOutage(seconds);
      sendJson(res, 202, { outageSeconds: seconds });
    },
  };

  const serveStatic = (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    fs.readFile(filePath, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  };

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const handler = routes[`${req.method} ${pathname}`];
    try {
      if (handler) return await handler(req, res);
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown endpoint' });
      if (req.method === 'GET') return serveStatic(req, res);
      sendJson(res, 405, { error: 'method not allowed' });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
  });

  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws' || !acceptUpgrade(req, socket)) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    // Send current state immediately so a fresh UI never renders empty.
    socket.write(encodeTextFrame(JSON.stringify({ type: 'config', data: simulator.config })));
    socket.write(encodeTextFrame(JSON.stringify({ type: 'telemetry', data: latest })));

    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const { frames, rest } = decodeFrames(buffered);
      buffered = rest;
      for (const f of frames) {
        if (f.opcode === 0x8) socket.end(); // close
        if (f.opcode === 0x9) socket.write(Buffer.from([0x8a, 0])); // ping -> pong
      }
    });
    const drop = () => clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);
  });

  return { server, simulator, clients };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '0.0.0.0';
  const { server, simulator } = createServer();
  simulator.start();
  server.listen(port, host, () => console.log(`voltwatch device service on http://${host}:${port}`));
  const shutdown = () => {
    simulator.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createServer };
