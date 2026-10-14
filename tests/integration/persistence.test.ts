import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@crusaders/server';
import { ClientSession, INPUT, createSyntheticArena, initPhysics, quantizeAngle, type InputFrame, type Rapier } from '@crusaders/shared';
import { backends, type TestDatabase } from './db_backends.ts';

const arena = createSyntheticArena();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rapier: Rapier;

// No converted levels (generatedDir '.'): accounts start in the synthetic arena, not the new game's act.
const baseConfig = { port: 0, host: '127.0.0.1', env: 'test' as const, logLevel: 'silent', httpBurst: 1000, generatedDir: '.' };

beforeAll(async () => {
  rapier = await initPhysics();
});

/** Minimal cookie-keeping HTTP client (Node fetch has no cookie jar). */
class Api {
  cookie = '';
  private readonly base: string;

  constructor(port: number) {
    this.base = `http://127.0.0.1:${port}`;
  }

  async call(method: string, route: string, body?: unknown): Promise<{ status: number; data: any }> {
    const res = await fetch(this.base + route, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return { status: res.status, data: await res.json() };
  }
}

async function play(port: number, api: Api): Promise<ClientSession> {
  const { status, data } = await api.call('POST', '/api/ws-ticket');
  expect(status).toBe(200);
  const s = new ClientSession(rapier, arena);
  await s.connect(`ws://127.0.0.1:${port}/ws`, data.ticket);
  return s;
}

async function run(s: ClientSession, flags: number, ticks: number): Promise<void> {
  const input: InputFrame = { clientTick: 0, flags, yaw: quantizeAngle(0), pitch: 0 };
  for (let i = 0; i < ticks; i++) {
    s.tick(input);
    await sleep(50);
  }
}

describe.each(backends)('accounts and sessions on $name (M07)', (backend) => {
  let server: RunningServer;
  let db: TestDatabase;
  beforeAll(async () => {
    db = await backend.create();
    server = await startServer({ ...baseConfig, databaseUrl: db.url });
  });
  afterAll(async () => {
    await server.close();
    await db.dispose();
  });

  it('lets exactly one of many concurrent registrations claim a username', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => new Api(server.port).call('POST', '/api/auth/register', { username: 'Racer', password: 'password123' })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    // The rest lose the race (409) or hit the per-username rate limit (429); never a second account.
    expect(statuses.every((s) => s === 201 || s === 409 || s === 429)).toBe(true);
    expect(statuses.filter((s) => s === 409).length).toBeGreaterThan(0);
  });

  it('registers, rejects duplicates and bad input, logs in and out', async () => {
    const api = new Api(server.port);
    const reg = await api.call('POST', '/api/auth/register', { username: 'Drake', password: 'correct horse' });
    expect(reg.status).toBe(201);
    expect(reg.data.characters).toHaveLength(1);
    expect(api.cookie).toMatch(/^co_session=/);

    expect((await new Api(server.port).call('POST', '/api/auth/register', { username: 'drake', password: 'another pass' })).status).toBe(409);
    expect((await new Api(server.port).call('POST', '/api/auth/register', { username: 'x', password: 'short' })).status).toBe(400);
    expect((await new Api(server.port).call('POST', '/api/auth/login', { username: 'Drake', password: 'wrong password' })).status).toBe(401);
    expect((await new Api(server.port).call('POST', '/api/auth/login', { username: 'nobody', password: 'whatever1' })).status).toBe(401);

    const me = await api.call('GET', '/api/auth/me');
    expect(me.data.username).toBe('Drake');

    const other = new Api(server.port);
    expect((await other.call('POST', '/api/auth/login', { username: 'DRAKE', password: 'correct horse' })).status).toBe(200);

    expect((await api.call('POST', '/api/auth/logout')).status).toBe(200);
    // Logout clears the cookie; without it no ticket is issued.
    expect(api.cookie).toBe('co_session=');
    expect((await api.call('POST', '/api/ws-ticket')).status).toBe(401);
  });

  it('revoked session tokens stop working', async () => {
    const api = new Api(server.port);
    await api.call('POST', '/api/auth/register', { username: 'Revoker', password: 'password123' });
    const token = api.cookie;
    expect((await api.call('POST', '/api/ws-ticket')).status).toBe(200);
    await api.call('POST', '/api/auth/logout');
    const stale = new Api(server.port);
    stale.cookie = token;
    expect((await stale.call('POST', '/api/ws-ticket')).status).toBe(401);
  });

  it('lists realms, creates up to three characters, deletes one and plays the chosen one', async () => {
    const api = new Api(server.port);
    await api.call('POST', '/api/auth/register', { username: 'Roster', password: 'password123' });
    const realms = await api.call('GET', '/api/realms');
    expect(realms.status).toBe(200);
    expect(realms.data.realms).toHaveLength(1);
    expect(realms.data.realms[0].characters).toBe(1);

    expect((await api.call('POST', '/api/characters', { name: 'x' })).status).toBe(400);
    expect((await api.call('POST', '/api/characters', { name: 'roster' })).status).toBe(409); // names are unique
    const second = await api.call('POST', '/api/characters', { name: 'Second' });
    expect(second.status).toBe(201);
    expect((await api.call('POST', '/api/characters', { name: 'Third' })).status).toBe(201);
    const full = await api.call('POST', '/api/characters', { name: 'Fourth' });
    expect(full.status).toBe(409);
    expect(full.data.error).toBe('character_limit');

    const list = await api.call('GET', '/api/characters');
    expect(list.data.max).toBe(3);
    expect(list.data.characters.map((c: { name: string }) => c.name)).toEqual(['Roster', 'Second', 'Third']);
    // Never played: the starting equipment, no time in the world.
    const fresh = list.data.characters[1];
    expect(fresh).toMatchObject({ level: 1, playSeconds: 0, lastPlayedAt: null, look: { weapon: 'long_sword', shield: 'wooden_shield' } });

    // Deleting asks for the name; other accounts cannot delete it.
    expect((await api.call('DELETE', `/api/characters/${fresh.id}`, { name: 'Wrong' })).status).toBe(400);
    const stranger = new Api(server.port);
    await stranger.call('POST', '/api/auth/register', { username: 'Stranger', password: 'password123' });
    expect((await stranger.call('DELETE', `/api/characters/${fresh.id}`, { name: 'Second' })).status).toBe(404);
    expect((await stranger.call('POST', '/api/ws-ticket', { characterId: fresh.id })).status).toBe(404);
    expect((await api.call('DELETE', `/api/characters/${fresh.id}`, { name: 'second' })).status).toBe(200);
    expect((await api.call('GET', '/api/characters')).data.characters).toHaveLength(2);

    // The ticket names the chosen character; leaving the world records the session.
    const third = (await api.call('GET', '/api/characters')).data.characters[1];
    const { data } = await api.call('POST', '/api/ws-ticket', { characterId: third.id });
    const s = new ClientSession(rapier, arena);
    await s.connect(`ws://127.0.0.1:${server.port}/ws`, data.ticket);
    await run(s, 0, 10);
    expect(s.character).not.toBeNull();
    s.close();
    let after: { name: string; lastPlayedAt: string | null } | undefined;
    for (let i = 0; i < 40 && !after?.lastPlayedAt; i++) {
      await sleep(50);
      after = (await api.call('GET', '/api/characters')).data.characters.find((c: { id: string }) => c.id === third.id);
    }
    expect(after?.lastPlayedAt).not.toBeNull();
  });

  it('saves the position on disconnect and restores it on the next login', async () => {
    const api = new Api(server.port);
    await api.call('POST', '/api/auth/register', { username: 'Walker', password: 'password123' });
    const first = await play(server.port, api);
    await run(first, 0, 15);
    await run(first, INPUT.FORWARD, 10);
    await run(first, 0, 6);
    const saved = { ...first.character!.position };
    first.close();
    await sleep(300);

    const second = await play(server.port, api);
    const restored = second.character!.position;
    expect(restored.x).toBeCloseTo(saved.x, 2);
    expect(restored.z).toBeCloseTo(saved.z, 2);
    second.close();
  });

  it('refuses the same character twice at once', async () => {
    const api = new Api(server.port);
    await api.call('POST', '/api/auth/register', { username: 'Twin', password: 'password123' });
    const a = await play(server.port, api);
    const { data } = await api.call('POST', '/api/ws-ticket');
    const b = new ClientSession(rapier, arena);
    await expect(b.connect(`ws://127.0.0.1:${server.port}/ws`, data.ticket)).rejects.toThrow(/1008/);
    a.close();
  });
});

describe.each(backends)('persistence across server restarts on $name (M07)', (backend) => {
  it('keeps accounts and character positions in the database', async () => {
    const db = await backend.create();
    const databaseUrl = db.url;
    let server = await startServer({ ...baseConfig, databaseUrl });
    const api = new Api(server.port);
    await api.call('POST', '/api/auth/register', { username: 'Survivor', password: 'password123' });
    const s = await play(server.port, api);
    await run(s, 0, 15);
    await run(s, INPUT.FORWARD, 8);
    await run(s, 0, 6);
    const saved = { ...s.character!.position };
    await server.close(); // disconnects the player and flushes before closing the DB

    server = await startServer({ ...baseConfig, databaseUrl });
    const again = new Api(server.port);
    expect((await again.call('POST', '/api/auth/login', { username: 'Survivor', password: 'password123' })).status).toBe(200);
    const s2 = await play(server.port, again);
    expect(s2.character!.position.z).toBeCloseTo(saved.z, 2);
    s2.close();
    await server.close();
    await db.dispose();
  });
});

describe.each(backends)('shutdown with an unresponsive client on $name (M07)', (backend) => {
  it('still saves a connected character whose socket never completes the close handshake', async () => {
    const { spawn } = await import('node:child_process');
    const db = await backend.create();
    let server = await startServer({ ...baseConfig, databaseUrl: db.url });
    const api = new Api(server.port);
    await api.call('POST', '/api/auth/register', { username: 'Frozen', password: 'password123' });
    const { data } = await api.call('POST', '/api/ws-ticket');
    const child = spawn(process.execPath, [new URL('./stuck_client.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), String(server.port), data.ticket]);
    try {
      const pos = await new Promise<{ x: number; z: number }>((resolve, reject) => {
        child.stdout.once('data', (d: Buffer) => resolve(JSON.parse(d.toString())));
        child.once('exit', (code) => reject(new Error(`client exited ${code}`)));
      });
      expect(pos.x).toBeGreaterThan(2.5); // 1 s of sidestepping
      const started = Date.now();
      await server.close();
      expect(Date.now() - started).toBeLessThan(5000);

      server = await startServer({ ...baseConfig, databaseUrl: db.url });
      const again = new Api(server.port);
      await again.call('POST', '/api/auth/login', { username: 'Frozen', password: 'password123' });
      const s = await play(server.port, again);
      expect(s.character!.position.x).toBeCloseTo(pos.x, 2);
      s.close();
      await server.close();
    } finally {
      child.kill();
      await db.dispose();
    }
  });
});
