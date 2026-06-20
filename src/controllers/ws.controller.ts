import * as WebSocket from 'ws';
import * as net from 'net';
import * as dgram from 'dgram';
import * as http from 'http';
import { UDP_TIMEOUT_MS } from '../config';
import {
  sniffProtocol,
  readTrojanHeader,
  readVmessHeader,
  readShadowsocksHeader,
  ProtocolHeader,
  PROTO_TROJAN,
  PROTO_VMESS,
} from '../protocols';

export class WsController {
  private udpSockets = new Map<string, { socket: dgram.Socket; ws: WebSocket.WebSocket }>();

  public handleConnection(ws: any, req: http.IncomingMessage) {
    console.log(`[ws] new connection from ${req.socket.remoteAddress}`);
    this.proxyWebSocket(ws);
  }

  private proxyWebSocket(ws: any) {
    let remote: net.Socket | null = null;
    let addrTag = '?:?';

    ws.on('message', async (raw: WebSocket.RawData) => {
      try {
        const chunk = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
          ? Buffer.concat(raw)
          : (Buffer.from(raw as any) as Buffer);

        // Once connected, forward directly
        if (remote) {
          remote.write(chunk);
          return;
        }

        // First message: sniff & parse header
        const proto = sniffProtocol(chunk);
        let header: ProtocolHeader;
        if (proto === PROTO_TROJAN) header = readTrojanHeader(chunk);
        else if (proto === PROTO_VMESS) header = readVmessHeader(chunk);
        else header = readShadowsocksHeader(chunk);

        if (header.hasError) throw new Error(header.message || 'Unknown protocol error');

        addrTag = `${header.addressRemote}:${header.portRemote}`;
        console.log(`[ws] ${proto} -> ${addrTag} (${header.isUDP ? 'UDP' : 'TCP'})`);

        if (header.isUDP) {
          this.handleUDP(header, chunk.subarray(header.rawDataIndex!), ws);
          return;
        }

        remote = await this.connectTCP(header.addressRemote!, header.portRemote!, header.rawClientData);
        this.pipeRemoteToWS(remote, ws, header.version!);

        remote.on('close', () => ws.readyState === WebSocket.OPEN && ws.close());
        remote.on('error', (e) => {
          console.error(`[tcp] ${addrTag} error:`, e.message);
          ws.close();
        });
      } catch (err: any) {
        console.error('[ws] message error:', err.message);
        ws.close(1011, err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[ws] closed ${addrTag}`);
      remote?.destroy();
      this.cleanupUDP(ws);
    });

    ws.on('error', (err: any) => console.error('[ws] error:', err.message));
  }

  private connectTCP(host: string, port: number, initialData?: Buffer): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        if (initialData?.length) socket.write(initialData);
        resolve(socket);
      });
      socket.on('error', reject);
    });
  }

  private pipeRemoteToWS(remote: net.Socket, ws: any, responseHeader: Buffer | null) {
    let header = responseHeader;
    remote.on('data', (chunk: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) {
        remote.destroy();
        return;
      }
      if (header) {
        ws.send(Buffer.concat([header, chunk]));
        header = null;
      } else {
        ws.send(chunk);
      }
    });
    remote.on('error', (e) => console.error('[remote] socket error:', e.message));
  }

  private handleUDP(header: ProtocolHeader, data: Buffer, ws: any) {
    const host = header.addressRemote!;
    const port = header.portRemote!;
    const version = header.version;

    const key = `${host}:${port}:${Date.now()}`;
    const sock = dgram.createSocket('udp4');

    let firstReply = version ? Buffer.from(version) : null;
    let timer: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch (_) {}
      this.udpSockets.delete(key);
    };

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(cleanup, UDP_TIMEOUT_MS);
    };

    sock.on('message', (msg) => {
      if (ws.readyState !== WebSocket.OPEN) return cleanup();
      if (firstReply) {
        ws.send(Buffer.concat([firstReply, msg]));
        firstReply = null;
      } else ws.send(msg);
      resetTimer();
    });

    sock.on('error', (e) => {
      console.error('[udp] error:', e.message);
      cleanup();
    });
    sock.on('close', () => this.udpSockets.delete(key));

    sock.send(data, port, host, (err) => {
      if (err) {
        console.error('[udp] send error:', err.message);
        cleanup();
      }
    });
    resetTimer();

    this.udpSockets.set(key, { socket: sock, ws });
    console.log(`[udp] ${host}:${port} key=${key}`);
  }

  private cleanupUDP(ws: any) {
    for (const [key, entry] of this.udpSockets) {
      if (entry.ws === ws) {
        try {
          entry.socket.close();
        } catch (_) {}
        this.udpSockets.delete(key);
      }
    }
  }

  public cleanupAllUDP() {
    this.udpSockets.forEach(({ socket }) => {
      try {
        socket.close();
      } catch (_) {}
    });
    this.udpSockets.clear();
  }
}
