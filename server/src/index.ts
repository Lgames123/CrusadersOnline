import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pino, type Logger } from 'pino';
import { BUILTIN_ITEMS, catalogFromItemRules } from '@crusaders/shared';
import { createAdminApi } from './admin/admin_api.ts';
import { AdminService } from './admin/admin_service.ts';
import { TicketStore } from './auth/tickets.ts';
import { REPO_ROOT, loadConfig, type ServerConfig } from './config.ts';
import { createApiHandler } from './http/api.ts';
import { TICK_ALARM_MS, metricsAllowed, renderMetrics } from './http/metrics.ts';
import { AccountRepository } from './persistence/accounts.ts';
import { EconomyRepository } from './persistence/economy.ts';
import { AdminRepository } from './persistence/admin.ts';
import { CharacterRepository } from './persistence/characters.ts';
import { migrateToLatest, openDatabase } from './persistence/db.ts';
import { SessionManager } from './network/sessions.ts';
import { createWsTransport } from './network/ws_transport.ts';
import { ZoneManager } from './zone/zone_manager.ts';

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
  log.info({ itemRules: config.itemRulesPath ?? 'built-in' }, 'item catalog');
  const accounts = new AccountRepository(database.db);
  const characters = new CharacterRepository(database.db);
  for (const name of config.adminUsers) if (await accounts.setAdmin(name, true)) log.info({ username: name }, 'admin (ADMIN_USERS)');

  // Saves are fire-and-forget from the zone's point of view; shutdown awaits them.
  const pendingSaves = new Set<Promise<void>>();
  const tickets = new TicketStore(config.wsTicketTtlSeconds);
  let sessions: SessionManager | null = null;
  const save = (records: Parameters<CharacterRepository['saveStates']>[0], reason: string) => {
    if (records.length === 0) return;
    const p = characters
      .saveStates(records)
      .then(() => log.debug({ count: records.length, reason }, 'characters saved'))
      .catch((err: unknown) => log.error({ err, reason }, 'character save failed'))
      .finally(() => pendingSaves.delete(p));
    pendingSaves.add(p);
  };
  // One zone worker per arena, started on demand (login into a saved zone, portals).
  const zones = new ZoneManager(
    { difficulty: config.difficulty, features: config.features, itemRulesPath: config.itemRulesPath, generatedDir: config.generatedDir },
    {
      deliver: (connId, data) => sessions?.deliver(connId, data),
      metrics: (m) => {
        log.debug(m, 'zone tick metrics');
        if (m.max > TICK_ALARM_MS) log.warn(m, `zone tick over ${TICK_ALARM_MS} ms`);
      },
      error: (arena, err) => log.error({ err, arena }, 'zone worker error'),
      persist: (records, reason) => save(records, reason),
      portal: (arena, connId, target, keep, via, waypoint) => sessions?.onPortal(arena, connId, target, keep, via, waypoint),
      transferred: (arena, connId, record, state) => sessions?.onTransferred(arena, connId, record, state),
      economy: (_arena, event) => sessions?.onEconomy(event),
      dungeon: (arena, connId, dungeon) => sessions?.onDungeon(arena, connId, dungeon),
      dungeonExit: (arena, connId) => sessions?.onDungeonExit(arena, connId),
      vitals: (arena, list) => sessions?.onVitals(arena, list),
      loot: (arena, { connId, character, chest, outcome, items }) =>
        log.info({ conn: connId, character, zone: arena, chest, items }, outcome === 'looted' ? 'chest looted' : 'chest not looted: inventory full'),
    },
  );
  if (!zones.available(config.arena)) throw new Error(`ARENA ${config.arena} is not available (convert the level into ${config.generatedDir})`);
  zones.keep(config.arena);
  await zones.get(config.arena);
  let admin: AdminService | null = null;
  // The zones' item catalog: the character screen, the auction house's names.
  const items = config.itemRulesPath ? catalogFromItemRules(JSON.parse(readFileSync(config.itemRulesPath, 'utf8')) as Parameters<typeof catalogFromItemRules>[0]) : BUILTIN_ITEMS;
  sessions = new SessionManager(tickets, zones, characters, log, {
    economy: new EconomyRepository(database.db),
    items,
    defaultArena: config.arena, difficulty: config.difficulty, devGuestSpawn: config.devGuestSpawn, devGuestSpells: config.devGuestSpells, devGuestXp: config.devGuestXp, devGuestFinished: config.devGuestFinished, devGuestItems: config.devGuestItems,
    persist: (r) => save(r, 'transfer'),
    onChat: (line) => admin?.chat(line),
    greeting: () => admin?.greeting() ?? null,
  });
  const live = sessions;
  const adminService = new AdminService({ sessions, zones, repo: new AdminRepository(database.db), items, log });
  admin = adminService;
  await adminService.start();
  const api = createApiHandler({
    config,
    accounts,
    characters,
    items,
    tickets,
    log,
    onlinePlayers: () => live.playerCount,
    isCharacterOnline: (id) => live.isCharacterActive(id),
    admin: createAdminApi(adminService),
  });

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { ok: true, arena: config.arena, zones: zones.names, tick: zones.host(config.arena)?.tick ?? 0, players: sessions!.playerCount });
    }
    if (req.method === 'GET' && url.pathname === '/metrics') {
      if (!metricsAllowed(config.metricsToken, req.headers.authorization)) return json(res, 401, { error: 'unauthorized' });
      const mem = process.memoryUsage();
      const body = renderMetrics({
        onlinePlayers: sessions!.playerCount,
        zones: zones.names.map((name) => {
          const h = zones.host(name);
          return { name, players: h?.members.size ?? 0, metrics: h?.lastMetrics ?? null };
        }),
        pendingSaves: pendingSaves.size,
        uptimeSeconds: process.uptime(),
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
      });
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
      return;
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
    adminService.stop();
    await zones.stopAll();
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
      adminService.stop();
      await zones.stopAll();
      await transport.close();
      http.closeAllConnections();
      await httpClosed;
      await Promise.allSettled([...pendingSaves]);
      await database.close();
    },
  };
}
