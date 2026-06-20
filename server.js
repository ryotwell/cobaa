// ============================================
// RAILWAY GATEWAY - FULL COMPLETE
// UI Cyberpunk + VLESS/Trojan Generator + WebSocket + UDP
// Ready to Deploy - Node.js
// ============================================

const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const url = require('url');

// Constants
const PROTOCOL_TROJAN = "trojan";
const PROTOCOL_VMESS = "vmess";

const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

class GatewayServer {
  constructor() {
    this.wss = null;
    this.httpServer = null;
    this.activeUDPConnections = new Map();
    this.CORS_HEADER_OPTIONS = CORS_HEADER_OPTIONS;
  }

  // ==================== HTTP HANDLERS ====================

  handleHealthCheck(req, res) {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'railway-gateway',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      features: {
        websocket: true,
        tcp: true,
        udp: true,
        protocols: ['trojan', 'vmess', 'ss']
      },
      network: {
        udp_supported: true,
        outbound_allowed: true
      }
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...this.CORS_HEADER_OPTIONS
    });
    res.end(JSON.stringify(healthData, null, 2));
  }

  handleCorsPreflight(req, res) {
    res.writeHead(200, this.CORS_HEADER_OPTIONS);
    res.end();
  }

  async handleApiRequest(req, res, parsedUrl) {
    try {
      if (parsedUrl.pathname === '/api/proxies') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...this.CORS_HEADER_OPTIONS });
        res.end(JSON.stringify([{ prxIP: "127.0.0.1", prxPort: "443", country: "LOCAL", message: "Standalone Mode Active - Proxy Bank Disabled" }], null, 2));
        return;
      }
    } catch (error) {
      console.error('API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  // ==================== MAIN HTTP HANDLER (UI CYBERPUNK FIXED) ====================
  async handleHttpRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    
    if (req.method === 'OPTIONS') {
      this.handleCorsPreflight(req, res);
      return;
    }
    
    if (parsedUrl.pathname === '/health') {
      this.handleHealthCheck(req, res);
      return;
    }
    
    if (parsedUrl.pathname.startsWith('/api/')) {
      await this.handleApiRequest(req, res, parsedUrl);
      return;
    }
    
    
    const targetReversePrx = process.env.REVERSE_PRX_TARGET;
    if (targetReversePrx) {
      await this.reverseWeb(req, res, targetReversePrx);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  // ==================== REVERSE PROXY ====================

  async reverseWeb(request, response, target, targetPath) {
    try {
      const targetUrl = new URL(request.url);
      const targetChunk = target.split(":");
      targetUrl.hostname = targetChunk[0];
      targetUrl.port = targetChunk[1]?.toString() || "443";
      targetUrl.pathname = targetPath || targetUrl.pathname;

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: request.method,
        headers: { ...request.headers }
      };
      options.headers['host'] = targetUrl.hostname;
      options.headers['x-forwarded-host'] = request.headers.host;

      const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request(options, (proxyRes) => {
        response.writeHead(proxyRes.statusCode, {
          ...Object.fromEntries(Object.entries(this.CORS_HEADER_OPTIONS)),
          ...Object.fromEntries(Object.entries(proxyRes.headers)),
          'x-proxied-by': 'Railway Gateway'
        });
        proxyRes.pipe(response);
      });

      proxyReq.on('error', (err) => {
        console.error('Proxy error:', err);
        response.writeHead(500);
        response.end('Proxy error');
      });

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        let body = [];
        request.on('data', (chunk) => body.push(chunk)).on('end', () => {
          proxyReq.write(Buffer.concat(body));
          proxyReq.end();
        });
      } else {
        proxyReq.end();
      }
    } catch (err) {
      console.error('Reverse web error:', err);
      response.writeHead(500);
      response.end('Internal server error');
    }
  }

  // ==================== WEBSOCKET HANDLERS ====================

  async handleWebSocketConnection(ws, request) {
    try {
      const parsedUrl = url.parse(request.url, true);
      const path = parsedUrl.pathname;
      console.log(`WebSocket request path: ${path} (Standalone Mode)`);
      
      await this.websocketHandler(ws);
    } catch (err) {
      console.error('WebSocket error:', err);
      ws.close(1011, 'Internal server error');
    }
  }

  async websocketHandler(ws) {
    let addressLog = "", portLog = "";
    const log = (info, event) => console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
    let remoteSocketWrapper = { value: null };

    ws.on('message', async (message) => {
      try {
        const chunk = Buffer.from(message);
        if (remoteSocketWrapper.value) { remoteSocketWrapper.value.write(chunk); return; }

        const protocol = await this.protocolSniffer(chunk);
        let protocolHeader;

        if (protocol === PROTOCOL_TROJAN) protocolHeader = this.readTrojanHeader(chunk);
        else if (protocol === PROTOCOL_VMESS) protocolHeader = this.readVmessHeader(chunk);
        else if (protocol === "ss") protocolHeader = this.readShadowsocksHeader(chunk);
        else throw new Error("Unknown Protocol!");

        addressLog = protocolHeader.addressRemote;
        portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;
        if (protocolHeader.hasError) throw new Error(protocolHeader.message);

        if (protocolHeader.isUDP) {
          return await this.handleUDPOutbound(protocolHeader.addressRemote, protocolHeader.portRemote, chunk.slice(protocolHeader.rawDataIndex), ws, protocolHeader.version, log);
        }

        this.handleTCPOutBound(remoteSocketWrapper, protocolHeader.addressRemote, protocolHeader.portRemote, protocolHeader.rawClientData, ws, protocolHeader.version, log);
      } catch (err) {
        console.error('WS message error:', err);
        ws.close(1011, err.message);
      }
    });

    ws.on('close', () => {
      if (remoteSocketWrapper.value) remoteSocketWrapper.value.end();
      this.cleanupUDPConnections(ws);
      log('WebSocket closed');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      this.cleanupUDPConnections(ws);
    });
  }

  // ==================== PROTOCOL SNIFFERS ====================

  async protocolSniffer(buffer) {
    if (buffer.length >= 62) {
      const d = buffer.slice(56, 60);
      if (d[0] === 0x0d && d[1] === 0x0a && [0x01,0x03,0x7f].includes(d[2]) && [0x01,0x03,0x04].includes(d[3])) return PROTOCOL_TROJAN;
    }
    const h = buffer.slice(1, 17).toString('hex');
    if (h.match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) return PROTOCOL_VMESS;
    return "ss";
  }

  async handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, responseHeader, log) {
    const connectAndWrite = (address, port) => new Promise((resolve, reject) => {
      const s = net.createConnection({ host: address, port }, () => { log(`connected to ${address}:${port}`); s.write(rawClientData); resolve(s); });
      s.on('error', reject);
    });
    try {
      const s = await connectAndWrite(addressRemote, portRemote);
      remoteSocket.value = s;
      s.on('close', () => webSocket.close());
      s.on('error', () => webSocket.close());
      this.remoteSocketToWS(s, webSocket, responseHeader, log);
    } catch(e) {
      log(`Connection failed: ${e.message}`);
      webSocket.close();
    }
  }

  async handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log) {
    return new Promise((resolve) => {
      try {
        let header = responseHeader;
        const key = `${targetAddress}:${targetPort}:${Date.now()}`;
        const sock = dgram.createSocket('udp4');
        this.activeUDPConnections.set(key, { socket: sock, webSocket });
        sock.on('error', (e) => { try{sock.close()}catch(_){} this.activeUDPConnections.delete(key); });
        sock.send(dataChunk, targetPort, targetAddress, (e) => { if(e){ try{sock.close()}catch(_){} this.activeUDPConnections.delete(key); } });
        sock.on('message', (msg) => {
          if (webSocket.readyState === WebSocket.OPEN) {
            if (header) { webSocket.send(Buffer.concat([Buffer.from(header), msg])); header = null; }
            else webSocket.send(msg);
          }
        });
        sock.on('close', () => this.activeUDPConnections.delete(key));
        let t = setTimeout(() => { try{sock.close()}catch(_){} this.activeUDPConnections.delete(key); }, 30000);
        sock.on('message', () => { clearTimeout(t); t = setTimeout(() => { try{sock.close()}catch(_){} this.activeUDPConnections.delete(key); }, 30000); });
      } catch(e) { console.error(`UDP error: ${e.message}`); }
    });
  }

  cleanupUDPConnections(webSocket) {
    for (const [key, conn] of this.activeUDPConnections) {
      if (conn.webSocket === webSocket) { try { conn.socket.close(); } catch(_) {} this.activeUDPConnections.delete(key); }
    }
  }

  readShadowsocksHeader(buf) {
    const at = buf[0]; let al = 0, avi = 1, av = "";
    if (at === 1) { al = 4; av = Array.from(buf.slice(avi, avi+al)).join("."); }
    else if (at === 3) { al = buf[avi]; avi += 1; av = buf.slice(avi, avi+al).toString(); }
    else if (at === 4) { al = 16; const ip = []; for(let i=0;i<8;i++) ip.push(buf.readUInt16BE(avi+i*2).toString(16)); av = ip.join(":"); }
    else return { hasError: true, message: `Invalid addr type: ${at}` };
    if (!av) return { hasError: true, message: "Address empty" };
    const pi = avi + al;
    const pr = buf.readUInt16BE(pi);
    return { hasError: false, addressRemote: av, portRemote: pr, rawDataIndex: pi+2, rawClientData: buf.slice(pi+2), version: null, isUDP: pr == 53 };
  }

  readVmessHeader(buf) {
    const v = buf[0]; let udp = false;
    const ol = buf[17]; const cmd = buf[18+ol];
    if (cmd === 2) udp = true; else if (cmd !== 1) return { hasError: true, message: `Cmd ${cmd} unsupported` };
    const pi = 18+ol+1; const pr = buf.readUInt16BE(pi);
    let ai = pi+2; const at = buf[ai]; let al = 0, avi = ai+1, av = "";
    if (at === 1) { al = 4; av = Array.from(buf.slice(avi, avi+al)).join("."); }
    else if (at === 2) { al = buf[avi]; avi += 1; av = buf.slice(avi, avi+al).toString(); }
    else if (at === 3) { al = 16; const ip = []; for(let i=0;i<8;i++) ip.push(buf.readUInt16BE(avi+i*2).toString(16)); av = ip.join(":"); }
    else return { hasError: true, message: `Invalid addr type: ${at}` };
    if (!av) return { hasError: true, message: "Address empty" };
    return { hasError: false, addressRemote: av, portRemote: pr, rawDataIndex: avi+al, rawClientData: buf.slice(avi+al), version: Buffer.from([v,0]), isUDP: udp };
  }

  readTrojanHeader(buf) {
    const db = buf.slice(58);
    if (db.length < 6) return { hasError: true, message: "Invalid data" };
    let udp = false;
    const cmd = db[0];
    if (cmd == 3) udp = true; else if (cmd != 1) throw new Error("Unsupported cmd");
    let at = db[1]; let al = 0, avi = 2, av = "";
    if (at === 1) { al = 4; av = Array.from(db.slice(avi, avi+al)).join("."); }
    else if (at === 3) { al = db[avi]; avi += 1; av = db.slice(avi, avi+al).toString(); }
    else if (at === 4) { al = 16; const ip = []; for(let i=0;i<8;i++) ip.push(db.readUInt16BE(avi+i*2).toString(16)); av = ip.join(":"); }
    else return { hasError: true, message: `Invalid addr type: ${at}` };
    if (!av) return { hasError: true, message: "Address empty" };
    const pi = avi + al;
    const pr = db.readUInt16BE(pi);
    return { hasError: false, addressRemote: av, portRemote: pr, rawDataIndex: pi+4, rawClientData: db.slice(pi+4), version: null, isUDP: udp };
  }

  remoteSocketToWS(remoteSocket, webSocket, responseHeader, log) {
    let header = responseHeader;
    remoteSocket.on('data', (chunk) => {
      if (webSocket.readyState !== WebSocket.OPEN) { remoteSocket.destroy(); return; }
      if (header) { webSocket.send(Buffer.concat([Buffer.from(header), chunk])); header = null; }
      else webSocket.send(chunk);
    });
    remoteSocket.on('error', (e) => console.error(`Socket error:`, e));
  }

  // ==================== START SERVER ====================

  start(port = process.env.PORT || 3000) {
    const server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res).catch(error => {
        console.error('HTTP handler error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      });
    });

    this.wss = new WebSocket.Server({ server, perMessageDeflate: false });

    this.wss.on('connection', (ws, req) => {
      this.handleWebSocketConnection(ws, req);
    });

    const gracefulShutdown = () => {
      console.log('Shutting down...');
      if (this.wss) { this.wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.close(); }); this.wss.close(); }
      for (const [key, conn] of this.activeUDPConnections) { try { conn.socket.close(); } catch(_) {} }
      this.activeUDPConnections.clear();
      if (this.httpServer) { this.httpServer.close(() => { console.log('Server closed'); process.exit(0); }); }
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    server.listen(port, '0.0.0.0', () => {
      console.log(`✅ Railway Gateway running on port ${port}`);
      console.log(`🌐 http://localhost:${port}`);
      console.log(`🔌 ws://localhost:${port}`);
    });

    this.httpServer = server;
    
    server.on('error', (error) => {
      console.error('Server error:', error);
      if (error.code === 'EADDRINUSE') { console.error(`Port ${port} in use`); process.exit(1); }
    });
  }
}

// ==================== START ====================
if (require.main === module) {
  const server = new GatewayServer();
  try { require('dotenv').config(); } catch (e) {}
  const port = process.env.PORT || 3000;
  server.start(port);
}

module.exports = GatewayServer;