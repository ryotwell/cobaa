import * as http from 'http';
import * as https from 'https';
import { parse as parseUrl } from 'url';
import { CORS_HEADERS, REVERSE_TARGET } from '../config';

export class HttpController {
  static async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const { pathname } = parseUrl(req.url || '', true);

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
      await HttpController.reverseProxy(req, res, REVERSE_TARGET);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  static async reverseProxy(req: http.IncomingMessage, res: http.ServerResponse, target: string) {
    try {
      const [hostname, rawPort] = target.split(':');
      const targetUrl = new URL(req.url || '', `https://${hostname}`);
      targetUrl.hostname = hostname;
      targetUrl.port = rawPort || '443';

      const options: http.RequestOptions | https.RequestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: { ...req.headers, host: targetUrl.hostname, 'x-forwarded-host': req.headers.host },
      };

      const proto = targetUrl.protocol === 'https:' ? https : http;
      const proxyReq = proto.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, { ...CORS_HEADERS, ...proxyRes.headers });
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
    } catch (err: any) {
      console.error('[reverse-proxy] fatal:', err.message);
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
}
