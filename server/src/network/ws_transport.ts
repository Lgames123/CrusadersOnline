import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { CONTROL_MAX_BYTES } from '@crusaders/shared';
import type { ClientConnection, Transport, TransportHandlers } from './transport.ts';

const HEARTBEAT_MS = 15_000;

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** `ws` implementation of the Transport, mounted on an existing HTTP server. */
export function createWsTransport(server: HttpServer, path: string, handlers: TransportHandlers): Transport {
  const wss = new WebSocketServer({ server, path, maxPayload: CONTROL_MAX_BYTES, perMessageDeflate: false });
  // HTTP server errors (e.g. EADDRINUSE) are re-emitted here; startServer reports them.
  wss.on('error', () => {});
  let nextId = 1;
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws, req) => {
    const conn: ClientConnection = {
      id: nextId++,
      remoteAddress: req.socket.remoteAddress ?? 'unknown',
      send(data) {
        if (ws.readyState === ws.OPEN) ws.send(data, { binary: typeof data !== 'string' });
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    };
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      handlers.message(conn, isBinary ? toBytes(data) : data.toString());
    });
    ws.on('close', () => handlers.close(conn));
    ws.on('error', () => ws.terminate());
    handlers.open(conn);
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    get connectionCount() {
      return wss.clients.size;
    },
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(1001, 'server shutting down');
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
