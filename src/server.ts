import * as http from 'http';
import * as WebSocket from 'ws';
import { PORT, REVERSE_TARGET } from './config';
import { HttpController } from './controllers/http.controller';
import { WsController } from './controllers/ws.controller';

export class GatewayServer {
  public httpServer: http.Server | null = null;
  public wss: WebSocket.Server | null = null;
  public wsController = new WsController();

  start() {
    this.httpServer = http.createServer((req, res) => {
      HttpController.handleRequest(req, res).catch((err) => {
        console.error('[http] unhandled error:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end('Internal Server Error');
      });
    });

    this.wss = new WebSocket.Server({ server: this.httpServer, perMessageDeflate: false });
    this.wss.on('connection', (ws: any, req) => this.wsController.handleConnection(ws, req));

    const shutdown = () => {
      console.log('[server] shutting down...');
      this.wss?.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.close());
      this.wss?.close();
      this.wsController.cleanupAllUDP();
      this.httpServer?.close(() => {
        console.log('[server] stopped');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    this.httpServer.on('error', (err: any) => {
      console.error('[server] error:', err.message);
      if (err.code === 'EADDRINUSE') process.exit(1);
    });

    this.httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[server] listening on port ${PORT}`);
      if (REVERSE_TARGET) console.log(`[server] reverse proxy -> ${REVERSE_TARGET}`);
    });
  }
}
