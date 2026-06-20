// ============================================
// RAILWAY GATEWAY - FULL COMPLETE
// UI Cyberpunk + VLESS/Trojan Generator + WebSocket + UDP
// Ready to Deploy - Node.js
// ============================================

const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const url = require('url');

// Constants
const horse = Buffer.from("dHJvamFu", 'base64').toString(); // "trojan"
const flash = Buffer.from("dm1lc3M=", 'base64').toString(); // "vmess"
const v2 = Buffer.from("djJyYXk=", 'base64').toString(); // "v2ray"
const neko = Buffer.from("Y2xhc2g=", 'base64').toString(); // "clash"

const KV_PRX_URL = "https://raw.githubusercontent.com/backup-heavenly-demons/gateway/refs/heads/main/kvProxyList.json";
const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// Region Mapping
const REGION_MAP = {
  ASIA: ["ID", "SG", "MY", "PH", "TH", "VN", "JP", "KR", "CN", "HK", "TW"],
  SOUTHASIA: ["IN", "BD", "PK", "LK", "NP", "AF", "BT", "MV"],
  CENTRALASIA: ["KZ", "UZ", "TM", "KG", "TJ"],
  NORTHASIA: ["RU"],
  MIDDLEEAST: ["AE", "SA", "IR", "IQ", "JO", "IL", "YE", "SY", "OM", "KW", "QA", "BH", "LB"],
  CIS: ["RU", "UA", "BY", "KZ", "UZ", "AM", "GE", "MD", "TJ", "KG", "TM", "AZ"],
  WESTEUROPE: ["FR", "DE", "NL", "BE", "AT", "CH", "IE", "LU", "MC"],
  EASTEUROPE: ["PL", "CZ", "SK", "HU", "RO", "BG", "MD", "UA", "BY"],
  NORTHEUROPE: ["SE", "FI", "NO", "DK", "EE", "LV", "LT", "IS"],
  SOUTHEUROPE: ["IT", "ES", "PT", "GR", "HR", "SI", "MT", "AL", "BA", "RS", "ME", "MK"],
  EUROPE: ["FR", "DE", "NL", "BE", "AT", "CH", "IE", "LU", "MC", "PL", "CZ", "SK", "HU", "RO", "BG", "MD", "UA", "BY", "SE", "FI", "NO", "DK", "EE", "LV", "LT", "IS", "IT", "ES", "PT", "GR", "HR", "SI", "MT", "AL", "BA", "RS", "ME", "MK"],
  AFRICA: ["ZA", "NG", "EG", "MA", "KE", "DZ", "TN", "GH", "CI", "SN", "ET"],
  NORTHAMERICA: ["US", "CA", "MX"],
  SOUTHAMERICA: ["BR", "AR", "CL", "CO", "PE", "VE", "EC", "UY", "PY", "BO"],
  LATAM: ["MX", "BR", "AR", "CL", "CO", "PE", "VE", "EC", "UY", "PY", "BO", "CR", "GT", "PA", "DO", "HN", "NI", "SV"],
  AMERICA: ["US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "VE", "EC"],
  OCEANIA: ["AU", "NZ", "PG", "FJ"],
  GLOBAL: []
};

class GatewayServer {
  constructor() {
    this.prxIP = "";
    this.cachedPrxList = [];
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
        const proxies = await this.getPrxList(process.env.PRX_BANK_URL);
        const format = parsedUrl.query.format || 'json';
        
        if (format === 'text') {
          const proxyText = proxies.map(p => 
            `${p.country} - ${p.prxIP}:${p.prxPort}`
          ).join('\n');
          
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            ...this.CORS_HEADER_OPTIONS
          });
          res.end(proxyText);
          return;
        }
        
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...this.CORS_HEADER_OPTIONS
        });
        res.end(JSON.stringify(proxies, null, 2));
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
    
    if (parsedUrl.pathname === '/') {
      const currentHost = req.headers.host || 'localhost:3000';
      const protocolWs = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
      const protocolHttp = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const uptime = Math.floor(process.uptime());
      const ramUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const nodeVersion = process.version;
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RAILWAY GATEWAY // DASHBOARD</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap');
    body { font-family: 'JetBrains Mono', monospace; background-color: #0a0b10; }
    .cyber-glow { box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); }
    .cyber-glow-green { box-shadow: 0 0 15px rgba(16, 185, 129, 0.4); }
    .neon-border { border: 1px solid rgba(59, 130, 246, 0.3); }
    .neon-border:hover { border-color: rgba(59, 130, 246, 0.8); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0f111a; }
    ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #3b82f6; }
  </style>
</head>
<body class="text-slate-300 min-h-screen flex flex-col justify-between selection:bg-blue-600 selection:text-white">

  <header class="border-b border-slate-900 bg-[#0d0e16]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="h-10 w-10 rounded-lg bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400 cyber-glow animate-pulse">
          <i class="fa-solid fa-terminal text-lg"></i>
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-wider text-white">RAILWAY_GATEWAY<span class="text-blue-500">.sys</span></h1>
          <p class="text-xs text-slate-500">CORE NODE ACTIVE & SECURED</p>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 bg-[#121420] neon-border px-4 py-2 rounded-lg">
          <span class="h-2.5 w-2.5 rounded-full bg-emerald-500 cyber-glow-green animate-ping"></span>
          <span class="text-xs font-semibold text-emerald-400 tracking-wider">SYSTEM ONLINE</span>
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-7xl w-full mx-auto p-6 space-y-8 flex-grow">
    
    <!-- STATS -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="bg-[#0d0e16] neon-border p-5 rounded-xl flex items-center justify-between">
        <div>
          <p class="text-xs text-slate-500 font-medium mb-1">SYSTEM UPTIME</p>
          <p id="uptime-val" class="text-lg font-bold text-white">${uptime}s</p>
        </div>
        <i class="fa-solid fa-clock text-slate-700 text-2xl"></i>
      </div>
      <div class="bg-[#0d0e16] neon-border p-5 rounded-xl flex items-center justify-between">
        <div>
          <p class="text-xs text-slate-500 font-medium mb-1">RAM ALLOCATION</p>
          <p class="text-lg font-bold text-white">${ramUsed} MB</p>
        </div>
        <i class="fa-solid fa-microchip text-slate-700 text-2xl"></i>
      </div>
      <div class="bg-[#0d0e16] neon-border p-5 rounded-xl flex items-center justify-between">
        <div>
          <p class="text-xs text-slate-500 font-medium mb-1">UDP TUNNELING</p>
          <p class="text-lg font-bold text-emerald-400">ENABLED</p>
        </div>
        <i class="fa-solid fa-bolt text-emerald-900/50 text-2xl"></i>
      </div>
      <div class="bg-[#0d0e16] neon-border p-5 rounded-xl flex items-center justify-between">
        <div>
          <p class="text-xs text-slate-500 font-medium mb-1">NODE VERSION</p>
          <p class="text-lg font-bold text-blue-400">${nodeVersion}</p>
        </div>
        <i class="fa-brands fa-node-js text-blue-900/50 text-2xl"></i>
      </div>
    </div>

    <!-- WEBSOCKET + REST -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      <div class="bg-[#0d0e16] border border-slate-900 rounded-xl p-6 space-y-4">
        <div class="flex items-center gap-2 border-b border-slate-900 pb-3">
          <i class="fa-solid fa-network-wired text-blue-400"></i>
          <h2 class="text-md font-bold tracking-wide text-white">WEBSOCKET ROUTING ENDPOINTS</h2>
        </div>
        <div class="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          
          <div class="bg-[#10121d] border border-slate-900/60 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-3 hover:bg-[#121524] transition">
            <div>
              <span class="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded font-bold border border-blue-500/20">TARGET COUNTRY</span>
              <p class="text-sm font-semibold text-slate-200 mt-2">${protocolWs}://${currentHost}/ID</p>
            </div>
            <button onclick="copyText('${protocolWs}://${currentHost}/ID')" class="text-xs bg-[#171a29] border border-slate-800 text-slate-400 hover:text-white hover:border-blue-500 px-3 py-1.5 rounded transition flex items-center gap-1.5 active:scale-95">
              <i class="fa-regular fa-copy"></i> COPY
            </button>
          </div>

          <div class="bg-[#10121d] border border-slate-900/60 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-3 hover:bg-[#121524] transition">
            <div>
              <span class="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded font-bold border border-purple-500/20">MULTI-COUNTRY (ROTATE)</span>
              <p class="text-sm font-semibold text-slate-200 mt-2">${protocolWs}://${currentHost}/PROXYLIST/ID,SG,JP</p>
            </div>
            <button onclick="copyText('${protocolWs}://${currentHost}/PROXYLIST/ID,SG,JP')" class="text-xs bg-[#171a29] border border-slate-800 text-slate-400 hover:text-white hover:border-blue-500 px-3 py-1.5 rounded transition flex items-center gap-1.5 active:scale-95">
              <i class="fa-regular fa-copy"></i> COPY
            </button>
          </div>

          <div class="bg-[#10121d] border border-slate-900/60 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-3 hover:bg-[#121524] transition">
            <div>
              <span class="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded font-bold border border-amber-500/20">REGION MATRICES</span>
              <p class="text-sm font-semibold text-slate-200 mt-2">${protocolWs}://${currentHost}/ASIA</p>
            </div>
            <button onclick="copyText('${protocolWs}://${currentHost}/ASIA')" class="text-xs bg-[#171a29] border border-slate-800 text-slate-400 hover:text-white hover:border-blue-500 px-3 py-1.5 rounded transition flex items-center gap-1.5 active:scale-95">
              <i class="fa-regular fa-copy"></i> COPY
            </button>
          </div>

          <div class="bg-[#10121d] border border-slate-900/60 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-3 hover:bg-[#121524] transition">
            <div>
              <span class="text-xs bg-pink-500/10 text-pink-400 px-2 py-0.5 rounded font-bold border border-pink-500/20">GLOBAL CLUSTER</span>
              <p class="text-sm font-semibold text-slate-200 mt-2">${protocolWs}://${currentHost}/ALL</p>
            </div>
            <button onclick="copyText('${protocolWs}://${currentHost}/ALL')" class="text-xs bg-[#171a29] border border-slate-800 text-slate-400 hover:text-white hover:border-blue-500 px-3 py-1.5 rounded transition flex items-center gap-1.5 active:scale-95">
              <i class="fa-regular fa-copy"></i> COPY
            </button>
          </div>

        </div>
      </div>

      <div class="bg-[#0d0e16] border border-slate-900 rounded-xl p-6 space-y-4">
        <div class="flex items-center gap-2 border-b border-slate-900 pb-3">
          <i class="fa-solid fa-gears text-emerald-400"></i>
          <h2 class="text-md font-bold tracking-wide text-white">REST INTEGRATION ENDPOINTS</h2>
        </div>
        <div class="space-y-3">
          
          <div class="bg-[#10121d] border border-slate-900/60 p-4 rounded-lg flex items-center justify-between hover:bg-[#121524] transition">
            <div>
              <span class="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-bold border border-emerald-500/20 mr-2">GET</span>
              <span class="text-xs text-slate-500 font-medium">JSON LIST DIRECTORY</span>
              <p class="text-sm font-semibold text-slate-200 mt-2">/api/proxies</p>
            </div>
            <a href="${protocolHttp}://${currentHost}/api/proxies" target="_blank" class="text-xs bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600 hover:text-white px-3 py-1.5 rounded transition">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> TEST
            </a>
          </div>

          <div class="bg-[#10121d] border border-slate-900/60 p-4 rounded-lg flex items-center justify-between hover:bg-[#121524] transition">
            <div>
              <span class="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-bold border border-emerald-500/20 mr-2">GET</span>
              <span class="text-xs text-slate-500 font-medium">PLAIN STRING PARSED</span>
              <p class="text-sm font-semibold text-slate-200 mt-2">/api/proxies?format=text</p>
            </div>
            <a href="${protocolHttp}://${currentHost}/api/proxies?format=text" target="_blank" class="text-xs bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600 hover:text-white px-3 py-1.5 rounded transition">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> TEST
            </a>
          </div>

          <div class="bg-[#10121d] border border-slate-900/60 p-4 rounded-lg flex items-center justify-between hover:bg-[#121524] transition">
            <div>
              <span class="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-bold border border-emerald-500/20 mr-2">GET</span>
              <span class="text-xs text-slate-500 font-medium">MICRO-CORE HEALTH MONITOR</span>
              <p class="text-sm font-semibold text-slate-200 mt-2">/health</p>
            </div>
            <a href="${protocolHttp}://${currentHost}/health" target="_blank" class="text-xs bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600 hover:text-white px-3 py-1.5 rounded transition">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> TEST
            </a>
          </div>

        </div>
      </div>

    </div>

    <!-- CURL EXAMPLES -->
    <div class="bg-[#0d0e16] border border-slate-900 rounded-xl p-6 space-y-4">
      <div class="flex items-center gap-2 border-b border-slate-900 pb-3">
        <i class="fa-solid fa-rectangle-list text-purple-400"></i>
        <h2 class="text-md font-bold tracking-wide text-white">INTEGRATION EXECUTION EXAMPLES</h2>
      </div>
      <div class="bg-[#07080e] rounded-lg p-5 border border-slate-950 font-mono text-xs sm:text-sm text-slate-400 space-y-4 overflow-x-auto">
        <div>
          <p class="text-slate-600 mb-1">// Query cluster via terminal cli line</p>
          <div class="flex items-center justify-between bg-[#0a0b12] p-3 rounded border border-slate-900">
            <span class="text-blue-400">curl ${protocolHttp}://${currentHost}/api/proxies</span>
            <button onclick="copyText('curl ${protocolHttp}://${currentHost}/api/proxies')" class="text-slate-600 hover:text-blue-400 transition"><i class="fa-regular fa-copy"></i></button>
          </div>
        </div>
        <div>
          <p class="text-slate-600 mb-1">// Direct tunneling streaming live mapping</p>
          <div class="flex items-center justify-between bg-[#0a0b12] p-3 rounded border border-slate-900">
            <span class="text-purple-400">wscat -c ${protocolWs}://${currentHost}/ID</span>
            <button onclick="copyText('wscat -c ${protocolWs}://${currentHost}/ID')" class="text-slate-600 hover:text-purple-400 transition"><i class="fa-regular fa-copy"></i></button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== VLESS & TROJAN GENERATOR (FIXED) ==================== -->
    <div class="bg-[#0d0e16] border border-slate-900 rounded-xl p-6 space-y-5">
      <div class="flex items-center gap-2 border-b border-slate-900 pb-3">
        <i class="fa-solid fa-key text-yellow-400"></i>
        <h2 class="text-md font-bold tracking-wide text-white">VLESS / TROJAN ACCOUNT GENERATOR</h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        <!-- INPUT SECTION -->
        <div class="space-y-4">
          <div>
            <label class="text-xs text-slate-400 font-medium mb-1.5 block">UUID / Password</label>
            <div class="flex gap-2">
              <input id="uuidInput" type="text" value="853b8456-0c0b-4bfa-b3b4-b2619248a9bc" 
                     class="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 focus:outline-none transition">
              <button id="randomUuidBtn" class="bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600 hover:text-white px-3 py-2 rounded-lg text-xs transition flex items-center gap-1 whitespace-nowrap">
                <i class="fa-solid fa-shuffle"></i> RANDOM
              </button>
            </div>
          </div>

          <div>
            <label class="text-xs text-slate-400 font-medium mb-1.5 block">Host / Domain</label>
            <input id="hostInput" type="text" value="${currentHost}" 
                   class="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 focus:outline-none transition">
          </div>

          <div>
            <label class="text-xs text-slate-400 font-medium mb-1.5 block">Port</label>
            <input id="portInput" type="text" value="443" 
                   class="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 focus:outline-none transition">
          </div>

          <div>
            <label class="text-xs text-slate-400 font-medium mb-1.5 block">Path</label>
            <div class="flex gap-2">
              <select id="pathSelect" 
                      class="bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 focus:outline-none transition">
                <option value="/ALL">🌍 /ALL (Rotate Global)</option>
                <option value="/ID">🇮🇩 /ID (Indonesia)</option>
                <option value="/SG">🇸🇬 /SG (Singapore)</option>
                <option value="/JP">🇯🇵 /JP (Japan)</option>
                <option value="/US">🇺🇸 /US (USA)</option>
                <option value="/ASIA">🌏 /ASIA (Asia Region)</option>
                <option value="/EUROPE">🇪🇺 /EUROPE</option>
                <option value="/AMERICA">🌎 /AMERICA</option>
                <option value="/PROXYLIST/ID,SG,JP">🔀 /PROXYLIST (Multi)</option>
                <option value="/PUTAR">🎰 /PUTAR (Spin)</option>
              </select>
              <input id="pathInput" type="text" value="/ALL" 
                     class="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 focus:outline-none transition">
            </div>
          </div>

          <!-- SNI SECTION (FIXED) -->
          <div>
            <label class="text-xs text-slate-400 font-medium mb-1.5 block">
              <i class="fa-solid fa-fingerprint text-purple-400 mr-1"></i> SNI (Server Name Indication)
            </label>
            <select id="sniSelect" 
                    class="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-purple-500 focus:outline-none transition mb-2">
              <option value="business.whatsapp.com">📱 business.whatsapp.com</option>
              <option value="media-sin6-3.cdn.whatsapp.net">📡 media-sin6-3.cdn.whatsapp.net</option>
              <option value="c.whatsapp.com">💬 c.whatsapp.com</option>
              <option value="web.whatsapp.com">🌐 web.whatsapp.com</option>
              <option value="v.whatsapp.net">📞 v.whatsapp.net</option>
              <option value="custom">✏️ CUSTOM SNI...</option>
            </select>
            <input id="sniInput" type="text" value="business.whatsapp.com" 
                   class="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-purple-500 focus:outline-none transition"
                   placeholder="Ketik manual SNI custom di sini...">
            <p class="text-[10px] text-slate-600 mt-1.5">Pilih dari daftar atau ketik manual SNI custom di kolom bawah</p>
          </div>

          <div>
            <label class="text-xs text-slate-400 font-medium mb-1.5 block">Nama / Remark</label>
            <input id="remarkInput" type="text" value="KOPI KAPAL ⚡" 
                   class="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 focus:outline-none transition">
          </div>

          <button id="generateBtn" 
                  class="w-full bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-400 hover:to-orange-500 text-black font-bold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2 active:scale-95">
            <i class="fa-solid fa-bolt"></i> GENERATE ACCOUNTS
          </button>
        </div>

        <!-- OUTPUT SECTION -->
        <div class="space-y-3">
          <label class="text-xs text-slate-400 font-medium block">📋 Hasil Generate</label>
          
          <div class="space-y-2">
            <div class="bg-[#07080e] rounded-lg p-4 border border-slate-950">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded font-bold border border-purple-500/20">VLESS</span>
                <button onclick="copyText(document.getElementById('vlessOutput').textContent)" 
                        class="text-xs bg-[#171a29] border border-slate-800 text-slate-400 hover:text-purple-400 px-2 py-1 rounded transition flex items-center gap-1">
                  <i class="fa-regular fa-copy"></i> COPY
                </button>
              </div>
              <p id="vlessOutput" class="text-xs text-purple-300 font-mono break-all leading-relaxed bg-[#0a0b12] p-2 rounded border border-slate-900">
                Loading...
              </p>
            </div>

            <div class="bg-[#07080e] rounded-lg p-4 border border-slate-950">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded font-bold border border-orange-500/20">TROJAN</span>
                <button onclick="copyText(document.getElementById('trojanOutput').textContent)" 
                        class="text-xs bg-[#171a29] border border-slate-800 text-slate-400 hover:text-orange-400 px-2 py-1 rounded transition flex items-center gap-1">
                  <i class="fa-regular fa-copy"></i> COPY
                </button>
              </div>
              <p id="trojanOutput" class="text-xs text-orange-300 font-mono break-all leading-relaxed bg-[#0a0b12] p-2 rounded border border-slate-900">
                Loading...
              </p>
            </div>
          </div>

          <div class="bg-[#10121d] border border-slate-800 rounded-lg p-3">
            <p class="text-[10px] text-slate-500 mb-1">🔗 FORMAT IMPORT CLASH META / V2RAY</p>
            <pre id="clashOutput" class="text-[11px] text-slate-400 font-mono break-all leading-relaxed whitespace-pre-wrap bg-[#0a0b12] p-2 rounded border border-slate-900 max-h-48 overflow-y-auto">Loading...</pre>
          </div>
        </div>

      </div>
    </div>

  </main>

  <footer class="border-t border-slate-950 bg-[#07080d] px-6 py-4 text-center text-xs text-slate-600">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
      <p>&copy; 2025 RAILWAY GATEWAY. ALL SYSTEM VECTORS OPERATIONAL.</p>
      <p class="flex items-center gap-1"><i class="fa-solid fa-shield text-blue-500/40"></i> SECURED BY END-TO-END KERNEL TUNNEL</p>
    </div>
  </footer>

  <div id="toast" class="fixed bottom-6 right-6 bg-blue-600 text-white font-semibold px-4 py-2.5 rounded-lg shadow-lg opacity-0 pointer-events-none transition-all duration-300 transform translate-y-2 text-xs z-50 flex items-center gap-2">
    <i class="fa-solid fa-circle-check"></i> ENDPOINT COPIED TO CLIPBOARD
  </div>

  <script>
    function copyText(text) {
      navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-2');
        toast.classList.add('opacity-100', 'translate-y-0');
        setTimeout(() => {
          toast.classList.remove('opacity-100', 'translate-y-0');
          toast.classList.add('opacity-0', 'pointer-events-none', 'translate-y-2');
        }, 2500);
      });
    }

    let uptimeStart = ${uptime};
    setInterval(() => {
      uptimeStart++;
      document.getElementById('uptime-val').innerText = uptimeStart + 's';
    }, 1000);

    function generateUUID() {
      const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      document.getElementById('uuidInput').value = uuid;
      generateAccounts();
    }

    function generateTrojanPass() {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let pass = '';
      for (let i = 0; i < 36; i++) {
        if (i === 8 || i === 13 || i === 18 || i === 23) { pass += '-'; }
        else { pass += chars.charAt(Math.floor(Math.random() * chars.length)); }
      }
      return pass;
    }

    function generateAccounts() {
      try {
        const uuid = document.getElementById('uuidInput').value.trim() || '853b8456-0c0b-4bfa-b3b4-b2619248a9bc';
        const host = document.getElementById('hostInput').value.trim() || '${currentHost}';
        const port = document.getElementById('portInput').value.trim() || '443';
        const path = document.getElementById('pathInput').value.trim() || '/ALL';
        const sni = document.getElementById('sniInput').value.trim() || 'business.whatsapp.com';
        const remark = document.getElementById('remarkInput').value.trim() || 'KOPI KAPAL';
        const encodedPath = encodeURIComponent(path);
        const encodedRemark = encodeURIComponent(remark);

        // VLESS
        const vlessUrl = 'vless://' + uuid + '@' + host + ':' + port +
                         '?encryption=none&security=tls&sni=' + sni +
                         '&fp=randomized&type=ws&host=' + host +
                         '&path=' + encodedPath + '#' + encodedRemark;

        // TROJAN (FIXED: security=tls)
        const trojanPass = generateTrojanPass();
        const trojanUrl = 'trojan://' + trojanPass + '@' + host + ':' + port +
                          '?security=tls&sni=' + sni +
                          '&type=ws&host=' + host +
                          '&path=' + encodedPath + '#' + encodedRemark;

        document.getElementById('vlessOutput').textContent = vlessUrl;
        document.getElementById('trojanOutput').textContent = trojanUrl;

        // CLASH META
        document.getElementById('clashOutput').textContent = 
          '- name: "' + remark + ' VLESS"\\n' +
          '  type: vless\\n' +
          '  server: ' + host + '\\n' +
          '  port: ' + port + '\\n' +
          '  uuid: ' + uuid + '\\n' +
          '  network: ws\\n' +
          '  tls: true\\n' +
          '  udp: true\\n' +
          '  sni: "' + sni + '"\\n' +
          '  client-fingerprint: randomized\\n' +
          '  ws-opts:\\n' +
          '    path: "' + path + '"\\n' +
          '    headers:\\n' +
          '      host: "' + host + '"\\n\\n' +
          '- name: "' + remark + ' TROJAN"\\n' +
          '  type: trojan\\n' +
          '  server: ' + host + '\\n' +
          '  port: ' + port + '\\n' +
          '  password: ' + trojanPass + '\\n' +
          '  network: ws\\n' +
          '  tls: true\\n' +
          '  udp: true\\n' +
          '  sni: "' + sni + '"\\n' +
          '  ws-opts:\\n' +
          '    path: "' + path + '"\\n' +
          '    headers:\\n' +
          '      host: "' + host + '"';
      } catch(err) { console.error('Generator Error:', err); }
    }

    // Init
    setTimeout(generateAccounts, 300);
    setTimeout(() => {
      ['uuidInput','hostInput','portInput','pathInput','sniInput','remarkInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', generateAccounts);
      });
      const pathSelect = document.getElementById('pathSelect');
      if (pathSelect) pathSelect.addEventListener('change', function() {
        document.getElementById('pathInput').value = this.value;
        generateAccounts();
      });
      const sniSelect = document.getElementById('sniSelect');
      if (sniSelect) sniSelect.addEventListener('change', function() {
        const sniInput = document.getElementById('sniInput');
        if (this.value === 'custom') { sniInput.value = ''; sniInput.focus(); }
        else { sniInput.value = this.value; generateAccounts(); }
      });
      const genBtn = document.getElementById('generateBtn');
      if (genBtn) genBtn.addEventListener('click', function(e) { e.preventDefault(); generateAccounts(); });
      const randBtn = document.getElementById('randomUuidBtn');
      if (randBtn) randBtn.addEventListener('click', function(e) { e.preventDefault(); generateUUID(); });
    }, 600);
  </script>
</body>
</html>`);
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

  // ==================== PROXY LIST MANAGEMENT ====================

  async getKVPrxList(kvPrxUrl = KV_PRX_URL) {
    if (!kvPrxUrl) throw new Error("No URL Provided!");
    try {
      const kvPrx = await fetch(kvPrxUrl);
      if (kvPrx.status == 200) return await kvPrx.json();
      console.error(`Failed to fetch KV proxy list: ${kvPrx.status}`);
      return {};
    } catch (error) {
      console.error('Error fetching KV proxy list:', error);
      return {};
    }
  }

  async getPrxList(prxBankUrl) {
    if (!prxBankUrl) return [];
    try {
      const response = await fetch(prxBankUrl);
      if (response.status === 200) {
        const data = await response.json();
        return data.map(proxy => {
          const ip = proxy.prxIP || proxy.ip || proxy.server;
          const port = proxy.prxPort || proxy.port;
          const country = proxy.country || proxy.cc || 'XX';
          if (!ip || !port) { console.warn('Invalid proxy format:', proxy); return null; }
          return { prxIP: ip, prxPort: port, country: country.toUpperCase() };
        }).filter(Boolean);
      }
      console.error(`Failed to fetch proxy list: ${response.status}`);
      return [];
    } catch (error) {
      console.error('Error fetching proxy list:', error);
      return [];
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
      console.log(`WebSocket request path: ${path}`);

      // /PROXYLIST/ID,SG,JP
      const proxyListMatch = path.match(/^\/PROXYLIST\/([A-Z]{2}(,[A-Z]{2})*)$/i);
      if (proxyListMatch) {
        const countryCodes = proxyListMatch[1].toUpperCase().split(",");
        const proxies = await this.getPrxList(process.env.PRX_BANK_URL);
        if (proxies.length === 0) {
          const kvPrx = await this.getKVPrxList();
          const availableCountries = countryCodes.filter(code => kvPrx[code] && kvPrx[code].length > 0);
          if (availableCountries.length === 0) { ws.close(1000, `No proxies for: ${countryCodes.join(",")}`); return; }
          const prxKey = availableCountries[Math.floor(Math.random() * availableCountries.length)];
          this.prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
        } else {
          const filteredProxies = proxies.filter(p => countryCodes.includes(p.country));
          if (filteredProxies.length === 0) { ws.close(1000, `No proxies for: ${countryCodes.join(",")}`); return; }
          const randomProxy = filteredProxies[Math.floor(Math.random() * filteredProxies.length)];
          this.prxIP = `${randomProxy.prxIP}:${randomProxy.prxPort}`;
        }
        console.log(`Selected Proxy: ${this.prxIP}`);
        await this.websocketHandler(ws);
        return;
      }

      // /ALL atau /ALLn
      const allMatch = path.match(/^\/ALL(\d+)?$/i);
      if (allMatch) {
        const index = allMatch[1] ? parseInt(allMatch[1], 10) - 1 : null;
        const proxies = await this.getPrxList(process.env.PRX_BANK_URL);
        if (proxies.length === 0) {
          const kvPrx = await this.getKVPrxList();
          const allProxies = Object.values(kvPrx).flat();
          if (allProxies.length === 0) { ws.close(1000, `No proxies for /ALL`); return; }
          this.prxIP = allProxies[Math.floor(Math.random() * allProxies.length)];
        } else {
          let selectedProxy;
          if (index === null) { selectedProxy = proxies[Math.floor(Math.random() * proxies.length)]; }
          else {
            const grouped = proxies.reduce((acc, p) => { if(!acc[p.country])acc[p.country]=[]; acc[p.country].push(p); return acc; }, {});
            const byIndex = [];
            for(const c in grouped) { if(index < grouped[c].length) byIndex.push(grouped[c][index]); }
            if(byIndex.length === 0) { ws.close(1000, `No proxy at index ${index+1}`); return; }
            selectedProxy = byIndex[Math.floor(Math.random() * byIndex.length)];
          }
          this.prxIP = `${selectedProxy.prxIP}:${selectedProxy.prxPort}`;
        }
        console.log(`Selected Proxy: ${this.prxIP}`);
        await this.websocketHandler(ws);
        return;
      }

      // /PUTAR atau /PUTARn
      const putarMatch = path.match(/^\/PUTAR(\d+)?$/i);
      if (putarMatch) {
        const countryCount = putarMatch[1] ? parseInt(putarMatch[1], 10) : null;
        const proxies = await this.getPrxList(process.env.PRX_BANK_URL);
        if (proxies.length === 0) {
          const kvPrx = await this.getKVPrxList();
          const countries = Object.keys(kvPrx).filter(c => kvPrx[c]?.length > 0);
          if (countries.length === 0) { ws.close(1000, `No proxies`); return; }
          const shuffled = [...countries].sort(() => Math.random() - 0.5);
          const selected = countryCount ? shuffled.slice(0, Math.min(countryCount, countries.length)) : shuffled;
          const prxKey = selected[Math.floor(Math.random() * selected.length)];
          this.prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
        } else {
          const grouped = proxies.reduce((acc, p) => { if(!acc[p.country])acc[p.country]=[]; acc[p.country].push(p); return acc; }, {});
          const countries = Object.keys(grouped);
          if (countries.length === 0) { ws.close(1000, `No proxies`); return; }
          const shuffled = [...countries].sort(() => Math.random() - 0.5);
          const selected = countryCount ? shuffled.slice(0, Math.min(countryCount, countries.length)) : shuffled;
          const selProxies = selected.map(c => grouped[c][Math.floor(Math.random() * grouped[c].length)]);
          const randomProxy = selProxies[Math.floor(Math.random() * selProxies.length)];
          this.prxIP = `${randomProxy.prxIP}:${randomProxy.prxPort}`;
        }
        console.log(`Selected Proxy: ${this.prxIP}`);
        await this.websocketHandler(ws);
        return;
      }

      // /REGION atau /REGIONn
      const regionMatch = path.match(/^\/([A-Z]+)(\d+)?$/i);
      if (regionMatch && REGION_MAP[regionMatch[1].toUpperCase()]) {
        const regionKey = regionMatch[1].toUpperCase();
        const index = regionMatch[2] ? parseInt(regionMatch[2], 10) - 1 : null;
        const countries = regionKey === "GLOBAL" ? [] : REGION_MAP[regionKey];
        const proxies = await this.getPrxList(process.env.PRX_BANK_URL);
        
        if (proxies.length === 0) {
          const kvPrx = await this.getKVPrxList();
          let available = [];
          if (regionKey === "GLOBAL") { available = Object.values(kvPrx).flat(); }
          else { for(const c of countries) { if(kvPrx[c]) available.push(...kvPrx[c]); } }
          if (available.length === 0) { ws.close(1000, `No proxies for: ${regionKey}`); return; }
          this.prxIP = index !== null ? (available[index] || available[Math.floor(Math.random() * available.length)]) : available[Math.floor(Math.random() * available.length)];
        } else {
          const filtered = regionKey === "GLOBAL" ? proxies : proxies.filter(p => countries.includes(p.country));
          if (filtered.length === 0) { ws.close(1000, `No proxies for: ${regionKey}`); return; }
          const sel = index !== null ? (filtered[index] || filtered[Math.floor(Math.random() * filtered.length)]) : filtered[Math.floor(Math.random() * filtered.length)];
          this.prxIP = `${sel.prxIP}:${sel.prxPort}`;
        }
        console.log(`Selected Proxy: ${this.prxIP}`);
        await this.websocketHandler(ws);
        return;
      }

      // /CC atau /CCn
      const countryMatch = path.match(/^\/([A-Z]{2})(\d+)?$/);
      if (countryMatch) {
        const countryCode = countryMatch[1].toUpperCase();
        const index = countryMatch[2] ? parseInt(countryMatch[2], 10) - 1 : null;
        const proxies = await this.getPrxList(process.env.PRX_BANK_URL);
        
        if (proxies.length === 0) {
          const kvPrx = await this.getKVPrxList();
          if (!kvPrx[countryCode] || kvPrx[countryCode].length === 0) { ws.close(1000, `No proxies for: ${countryCode}`); return; }
          this.prxIP = index !== null ? (kvPrx[countryCode][index] || kvPrx[countryCode][0]) : kvPrx[countryCode][Math.floor(Math.random() * kvPrx[countryCode].length)];
        } else {
          const filtered = proxies.filter(p => p.country === countryCode);
          if (filtered.length === 0) { ws.close(1000, `No proxies for: ${countryCode}`); return; }
          const sel = index !== null ? (filtered[index] || filtered[0]) : filtered[Math.floor(Math.random() * filtered.length)];
          this.prxIP = `${sel.prxIP}:${sel.prxPort}`;
        }
        console.log(`Selected Proxy: ${this.prxIP}`);
        await this.websocketHandler(ws);
        return;
      }

      // /ip:port
      const ipPortMatch = path.match(/^\/(.+[:=-]\d+)$/);
      if (ipPortMatch) {
        this.prxIP = ipPortMatch[1].replace(/[=:-]/, ":");
        console.log(`Direct Proxy: ${this.prxIP}`);
        await this.websocketHandler(ws);
        return;
      }

      // Legacy: /ID,SG,JP
      if (path.length === 4 || path.includes(',')) {
        const prxKeys = path.replace("/", "").toUpperCase().split(",");
        const prxKey = prxKeys[Math.floor(Math.random() * prxKeys.length)];
        const kvPrx = await this.getKVPrxList();
        if (kvPrx[prxKey] && kvPrx[prxKey].length > 0) {
          this.prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
          console.log(`Legacy Proxy: ${this.prxIP}`);
          await this.websocketHandler(ws);
          return;
        }
        ws.close(1000, `No proxies for: ${prxKey}`);
        return;
      }

      ws.close(1000, "Invalid WebSocket path");
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

        if (protocol === horse) protocolHeader = this.readHorseHeader(chunk);
        else if (protocol === flash) protocolHeader = this.readFlashHeader(chunk);
        else if (protocol === "ss") protocolHeader = this.readSsHeader(chunk);
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
      if (d[0] === 0x0d && d[1] === 0x0a && [0x01,0x03,0x7f].includes(d[2]) && [0x01,0x03,0x04].includes(d[3])) return horse;
    }
    const h = buffer.slice(1, 17).toString('hex');
    if (h.match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) return flash;
    return "ss";
  }

  async handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, responseHeader, log) {
    const connectAndWrite = (address, port) => new Promise((resolve, reject) => {
      const s = net.createConnection({ host: address, port }, () => { log(`connected to ${address}:${port}`); s.write(rawClientData); resolve(s); });
      s.on('error', reject);
    });
    const retry = async () => {
      try {
        const s = await connectAndWrite(this.prxIP.split(/[:=-]/)[0] || addressRemote, this.prxIP.split(/[:=-]/)[1] || portRemote);
        remoteSocket.value = s;
        s.on('close', () => webSocket.close());
        s.on('error', () => webSocket.close());
        this.remoteSocketToWS(s, webSocket, responseHeader, null, log);
      } catch(e) { webSocket.close(); }
    };
    try {
      const s = await connectAndWrite(addressRemote, portRemote);
      remoteSocket.value = s;
      s.on('close', () => webSocket.close());
      s.on('error', () => webSocket.close());
      this.remoteSocketToWS(s, webSocket, responseHeader, retry, log);
    } catch(e) { await retry(); }
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

  readSsHeader(buf) {
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

  readFlashHeader(buf) {
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

  readHorseHeader(buf) {
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

  remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
    let header = responseHeader, hasData = false;
    remoteSocket.on('data', (chunk) => {
      hasData = true;
      if (webSocket.readyState !== WebSocket.OPEN) { remoteSocket.destroy(); return; }
      if (header) { webSocket.send(Buffer.concat([Buffer.from(header), chunk])); header = null; }
      else webSocket.send(chunk);
    });
    remoteSocket.on('close', () => { if (!hasData && retry) retry(); });
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
  console.log(process.env);
  const port = process.env.PORT || 3000;
  server.start(port);
}

module.exports = GatewayServer;