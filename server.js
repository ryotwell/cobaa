'use strict';

const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const { parse: parseUrl } = require('url');

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
const REVERSE_TARGET = process.env.REVERSE_PRX_TARGET || '';
const UDP_TIMEOUT_MS = 30_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// ─── Protocol identifiers ─────────────────────────────────────────────────────

const PROTO_TROJAN = 'trojan';
const PROTO_VMESS  = 'vmess';
const PROTO_SS     = 'ss';

// ─── Address parser helper ────────────────────────────────────────────────────

function parseAddress(buf, offset) {
  const addrType = buf[offset];
  let addrLen = 0, addrStart = offset + 1, addr = '';

  if (addrType === 1) {
    addrLen = 4;
    addr = Array.from(buf.slice(addrStart, addrStart + addrLen)).join('.');
  } else if (addrType === 2 || addrType === 3) {
    addrLen = buf[addrStart];
    addrStart += 1;
    addr = buf.slice(addrStart, addrStart + addrLen).toString();
  } else if (addrType === 4) {
    addrLen = 16;
    const parts = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(addrStart + i * 2).toString(16));
    addr = parts.join(':');
  } else {
    return { error: `Unknown address type: ${addrType}` };
  }

  if (!addr) return { error: 'Empty address' };
  return { addr, end: addrStart + addrLen };
}

// ─── Protocol header readers ──────────────────────────────────────────────────

function readTrojanHeader(buf) {
  const payload = buf.slice(58);
  if (payload.length < 6) return { hasError: true, message: 'Trojan: payload too short' };

  const cmd = payload[0];
  const isUDP = cmd === 3;
  if (cmd !== 1 && cmd !== 3) return { hasError: true, message: `Trojan: unsupported cmd ${cmd}` };

  const parsed = parseAddress(payload, 1);
  if (parsed.error) return { hasError: true, message: parsed.error };

  const portOffset = parsed.end;
  const port = payload.readUInt16BE(portOffset);

  return {
    hasError: false,
    addressRemote: parsed.addr,
    portRemote: port,
    rawDataIndex: portOffset + 4,
    rawClientData: payload.slice(portOffset + 4),
    version: null,
    isUDP,
  };
}

function readVmessHeader(buf) {
  const version = buf[0];
  const optLen = buf[17];
  const cmd = buf[18 + optLen];
  const isUDP = cmd === 2;
  if (cmd !== 1 && cmd !== 2) return { hasError: true, message: `VMess: unsupported cmd ${cmd}` };

  const portOffset = 18 + optLen + 1;
  const port = buf.readUInt16BE(portOffset);

  const parsed = parseAddress(buf, portOffset + 2);
  if (parsed.error) return { hasError: true, message: parsed.error };

  return {
    hasError: false,
    addressRemote: parsed.addr,
    portRemote: port,
    rawDataIndex: parsed.end,
    rawClientData: buf.slice(parsed.end),
    version: Buffer.from([version, 0]),
    isUDP,
  };
}

function readShadowsocksHeader(buf) {
  const parsed = parseAddress(buf, 0);
  if (parsed.error) return { hasError: true, message: parsed.error };

  const port = buf.readUInt16BE(parsed.end);

  return {
    hasError: false,
    addressRemote: parsed.addr,
    portRemote: port,
    rawDataIndex: parsed.end + 2,
    rawClientData: buf.slice(parsed.end + 2),
    version: null,
    isUDP: port === 53,
  };
}

// ─── Protocol sniffer ─────────────────────────────────────────────────────────

function sniffProtocol(buf) {
  // Trojan: CRLF + specific bytes at offset 56
  if (buf.length >= 62) {
    const d = buf.slice(56, 60);
    if (
      d[0] === 0x0d && d[1] === 0x0a &&
      [0x01, 0x03, 0x7f].includes(d[2]) &&
      [0x01, 0x03, 0x04].includes(d[3])
    ) return PROTO_TROJAN;
  }
  // VMess: UUID-like pattern at bytes 1–17
  const hex = buf.slice(1, 17).toString('hex');
  if (/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i.test(hex)) {
    return PROTO_VMESS;
  }
  return PROTO_SS;
}

// ─── Gateway Server ───────────────────────────────────────────────────────────

class GatewayServer {
  constructor() {
    this.httpServer = null;
    this.wss = null;
    this.udpSockets = new Map(); // key -> { socket, ws }
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async handleHttpRequest(req, res) {
    const { pathname } = parseUrl(req.url, true);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      }));
      return;
    }

    if (REVERSE_TARGET) {
      await this._reverseProxy(req, res, REVERSE_TARGET);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  async _reverseProxy(req, res, target) {
    try {
      const [hostname, rawPort] = target.split(':');
      const targetUrl = new URL(req.url, `https://${hostname}`);
      targetUrl.hostname = hostname;
      targetUrl.port = rawPort || '443';

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: { ...req.headers, host: targetUrl.hostname, 'x-forwarded-host': req.headers.host },
      };

      const proto = targetUrl.protocol === 'https:' ? https : http;
      const proxyReq = proto.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, { ...CORS_HEADERS, ...proxyRes.headers });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[reverse-proxy] error:', err.message);
        if (!res.headersSent) res.writeHead(502);
        res.end('Bad Gateway');
      });

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (err) {
      console.error('[reverse-proxy] fatal:', err.message);
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  handleWebSocketConnection(ws, req) {
    console.log(`[ws] new connection from ${req.socket.remoteAddress}`);
    this._proxyWebSocket(ws);
  }

  _proxyWebSocket(ws) {
    let remote = null;
    let addrTag = '?:?';

    ws.on('message', async (raw) => {
      try {
        const chunk = Buffer.from(raw);

        // Once connected, forward directly
        if (remote) { remote.write(chunk); return; }

        // First message: sniff & parse header
        const proto = sniffProtocol(chunk);
        let header;
        if (proto === PROTO_TROJAN)      header = readTrojanHeader(chunk);
        else if (proto === PROTO_VMESS)  header = readVmessHeader(chunk);
        else                             header = readShadowsocksHeader(chunk);

        if (header.hasError) throw new Error(header.message);

        addrTag = `${header.addressRemote}:${header.portRemote}`;
        console.log(`[ws] ${proto} -> ${addrTag} (${header.isUDP ? 'UDP' : 'TCP'})`);

        if (header.isUDP) {
          this._handleUDP(header, chunk.slice(header.rawDataIndex), ws);
          return;
        }

        remote = await this._connectTCP(header.addressRemote, header.portRemote, header.rawClientData);
        this._pipeRemoteToWS(remote, ws, header.version);

        remote.on('close', () => ws.readyState === WebSocket.OPEN && ws.close());
        remote.on('error', (e) => { console.error(`[tcp] ${addrTag} error:`, e.message); ws.close(); });
      } catch (err) {
        console.error('[ws] message error:', err.message);
        ws.close(1011, err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[ws] closed ${addrTag}`);
      remote?.destroy();
      this._cleanupUDP(ws);
    });

    ws.on('error', (err) => console.error('[ws] error:', err.message));
  }

  _connectTCP(host, port, initialData) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        if (initialData?.length) socket.write(initialData);
        resolve(socket);
      });
      socket.on('error', reject);
    });
  }

  _pipeRemoteToWS(remote, ws, responseHeader) {
    let header = responseHeader;
    remote.on('data', (chunk) => {
      if (ws.readyState !== WebSocket.OPEN) { remote.destroy(); return; }
      if (header) {
        ws.send(Buffer.concat([Buffer.from(header), chunk]));
        header = null;
      } else {
        ws.send(chunk);
      }
    });
    remote.on('error', (e) => console.error('[remote] socket error:', e.message));
  }

  // ── UDP ───────────────────────────────────────────────────────────────────

  _handleUDP(header, data, ws) {
    const { addressRemote: host, portRemote: port, version } = header;
    const key = `${host}:${port}:${Date.now()}`;
    const sock = dgram.createSocket('udp4');

    let firstReply = version ? Buffer.from(version) : null;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      try { sock.close(); } catch (_) {}
      this.udpSockets.delete(key);
    };

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(cleanup, UDP_TIMEOUT_MS);
    };

    sock.on('message', (msg) => {
      if (ws.readyState !== WebSocket.OPEN) return cleanup();
      if (firstReply) { ws.send(Buffer.concat([firstReply, msg])); firstReply = null; }
      else ws.send(msg);
      resetTimer();
    });

    sock.on('error', (e) => { console.error('[udp] error:', e.message); cleanup(); });
    sock.on('close', () => this.udpSockets.delete(key));

    sock.send(data, port, host, (err) => { if (err) { console.error('[udp] send error:', err.message); cleanup(); } });
    resetTimer();

    this.udpSockets.set(key, { socket: sock, ws });
    console.log(`[udp] ${host}:${port} key=${key}`);
  }

  _cleanupUDP(ws) {
    for (const [key, entry] of this.udpSockets) {
      if (entry.ws === ws) {
        try { entry.socket.close(); } catch (_) {}
        this.udpSockets.delete(key);
      }
    }
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  start() {
    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res).catch((err) => {
        console.error('[http] unhandled error:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end('Internal Server Error');
      });
    });

    this.wss = new WebSocket.Server({ server: this.httpServer, perMessageDeflate: false });
    this.wss.on('connection', (ws, req) => this.handleWebSocketConnection(ws, req));

    const shutdown = () => {
      console.log('[server] shutting down...');
      this.wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.close());
      this.wss.close();
      this.udpSockets.forEach(({ socket }) => { try { socket.close(); } catch (_) {} });
      this.udpSockets.clear();
      this.httpServer.close(() => { console.log('[server] stopped'); process.exit(0); });
      setTimeout(() => process.exit(1), 10_000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    this.httpServer.on('error', (err) => {
      console.error('[server] error:', err.message);
      if (err.code === 'EADDRINUSE') process.exit(1);
    });

    this.httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[server] listening on port ${PORT}`);
      if (REVERSE_TARGET) console.log(`[server] reverse proxy -> ${REVERSE_TARGET}`);
    });
  }
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

if (require.main === module) {
  try { require('dotenv').config(); } catch (_) {}
  new GatewayServer().start();
}

module.exports = GatewayServer;