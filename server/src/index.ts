import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pino, type Logger } from 'pino';
import { TicketStore } from './auth/tickets.ts';
import { REPO_ROOT, loadConfig, type ServerConfig } from './config.ts';
import { createApiHandler } from './http/api.ts';
import { AccountRepository } from './persistence/accounts.ts';
import { CharacterRepository } from './persistence/characters.ts';
import { migrateToLatest, openDatabase } from './persistence/db.ts';
import { SessionManager } from './network/sessions.ts';
import { createWsTransport } from './network/ws_transport.ts';
import { ZoneHost } from './zone/zone_host.ts';

export interface RunningServer {
  port: number;
  log: Logger;
  close(): Promise<void>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Boots database, HTTP API, WebSocket gateway and one zone worker. Used by main.ts and integration tests. */
export async function startServer(overrides: Partial<ServerConfig> = {}, log?: Logger): Promise<RunningServer> {
  const config = loadConfig(overrides);
  log ??= pino({ level: config.logLevel });
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required in production');

  const database = await openDatabase(config.databaseUrl, REPO_ROOT);
  const applied = await migrateToLatest(database.db);
  for (const m of applied) log.info({ migration: m.migrationName, status: m.status }, 'migration');
  log.info({ kind: database.kind }, 'database ready');
  const accounts = new AccountRepository(database.db);
  const characters = new CharacterRepository(database.db);

  // Saves are fire-and-forget from the zone's point of view; shutdown awaits them.
  const pendingSaves = new Set<Promise<void>>();
  const tickets = new TicketStore(config.wsTicketTtlSeconds);
  let sessions: SessionManager | null = null;
  const zone = new ZoneHost(
    { zone: 'arena-1', arena: 'synthetic-arena' },
    {
      deliver: (connId, data) => sessions?.deliver(connId, data),
      metrics: (m) => log.debug(m, 'zone tick metrics'),
      error: (err) => log.error({ err }, 'zone worker error'),
      persist: (records, reason) => {
        if (records.length === 0) return;
        const p = characters
          .saveStates(records)
          .then(() => log.debug({ count: records.length, reason }, 'characters saved'))
          .catch((err: unknown) => log.error({ err, reason }, 'character save failed'))
          .finally(() => pendingSaves.delete(p));
        pendingSaves.add(p);
      },
    },
  );
  await zone.whenReady();
  sessions = new SessionManager(tickets, zone, characters, log);
  const api = createApiHandler({ config, accounts, tickets, log });

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { ok: true, zone: zone.zone, tick: zone.tick, players: sessions!.playerCount });
    }
    if (url.pathname.startsWith('/api/')) {
      void api(req, res, url.pathname).then((handled) => {
        if (!handled) json(res, 404, { error: 'not_found' });
      });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });

  const transport = createWsTransport(http, '/ws', sessions);
  const shutdownBackends = async () => {
    await zone.stop();
    await Promise.allSettled([...pendingSaves]);
    await database.close();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(config.port, config.host, () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    await transport.close();
    await shutdownBackends();
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`port ${config.host}:${config.port} is already in use (another server running?). Stop it or set SERVER_PORT.`);
    }
    throw err;
  }
  const port = (http.address() as AddressInfo).port;
  log.info({ host: config.host, port, env: config.env }, `server listening on ws://${config.host}:${port}/ws`);

  return {
    port,
    log,
    async close() {
      // Order matters: saving must not depend on clients completing a close handshake.
      // 1. Stop accepting connections. 2. Stop the zone, which flushes every character still in
      // the world. 3. Close (then terminate) sockets and idle HTTP connections. 4. Await saves.
      const httpClosed = new Promise<void>((resolve) => http.close(() => resolve()));
      await zone.stop();
      await transport.close();
      http.closeAllConnections();
      await httpClosed;
      await Promise.allSettled([...pendingSaves]);
      await database.close();
    },
  };
}
