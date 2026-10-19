import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@crusaders/server';
import { ClientSession, createSyntheticArena, initPhysics, type ChatBroadcastMsg, type EntityInfo, type Rapier } from '@crusaders/shared';
import { backends, type TestDatabase } from './db_backends.ts';

/** The admin panel's API: who gets in, chat log and staff lines, mutes, events, custom spawns, bans. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rapier: Rapier;
let dir: string;

beforeAll(async () => {
  rapier = await initPhysics();
  dir = await mkdtemp(path.join(tmpdir(), 'crusaders-admin-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Line = ChatBroadcastMsg['d'];

describe.each(backends.slice(0, 1))('admin panel on $name', (backend) => {
  let server: RunningServer;
  let db: TestDatabase;
  let base = '';
  beforeAll(async () => {
    db = await backend.create();
    server = await startServer({ port: 0, host: '127.0.0.1', env: 'test', logLevel: 'silent', httpBurst: 1000, databaseUrl: db.url, arena: 'synthetic-arena', generatedDir: dir, adminUsers: ['boss'] });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    await server.close();
    await db.dispose();
  });

  async function call<T = Record<string, unknown>>(route: string, cookie: string, body?: unknown): Promise<{ status: number; cookie: string; data: T }> {
    const res = await fetch(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? cookie, data: (await res.json()) as T };
  }

  async function join(name: string) {
    const reg = await call('/api/auth/register', '', { username: name, password: 'password123' });
    const t = { data: (await (await fetch(`${base}/api/ws-ticket`, { method: 'POST', headers: { cookie: reg.cookie } })).json()) as { ticket: string } };
    const lines: Line[] = [];
    const spawns: { name: string; info: EntityInfo }[] = [];
    let closed: string | null = null;
    const s: ClientSession = new ClientSession(rapier, createSyntheticArena(), {
      zone: () => {
        s.setArena(createSyntheticArena());
        s.zoneReady('synthetic-arena');
      },
      chat: (d) => lines.push(d),
      spawn: (_id, n, info) => spawns.push({ name: n, info }),
      close: (_code, reason) => (closed = reason),
    });
    await s.connect(`ws://127.0.0.1:${server.port}/ws`, t.data.ticket, 10_000);
    for (let i = 0; i < 40 && !s.character; i++) await sleep(50);
    return { s, lines, spawns, cookie: reg.cookie, closed: () => closed };
  }

  it('lets admins in and runs chat, moderation, events and spawns', async () => {
    const boss = await call('/api/auth/register', '', { username: 'Boss', password: 'password123' });
    expect(boss.data['admin']).toBe(true);
    const alice = await join('Alice');
    expect((await call('/api/admin/me', alice.cookie)).status).toBe(403);
    expect((await call('/api/admin/me', '')).status).toBe(401);
    expect((await call<{ username: string }>('/api/admin/me', boss.cookie)).data.username).toBe('Boss');

    // The chat log sees players' lines; the staff's reach every player as `admin` lines.
    alice.s.chat('global', 'hello all');
    await sleep(200);
    const log = await call<{ lines: { channel: string; from: string; text: string }[] }>('/api/admin/chat', boss.cookie);
    expect(log.data.lines.at(-1)).toMatchObject({ channel: 'global', from: 'Alice', text: 'hello all' });
    expect((await call('/api/admin/chat', boss.cookie, { mode: 'announce', text: 'Server restarts at noon' })).status).toBe(200);
    await sleep(200);
    expect(alice.lines.at(-1)).toEqual({ channel: 'system', kind: 'admin', text: 'Server restarts at noon' });

    // Muted: refused with a notice and kept out of the log; unmuted: heard again.
    expect((await call<{ message: string }>('/api/admin/moderate', boss.cookie, { action: 'mute', target: 'alice', minutes: 5 })).data.message).toMatch(/muted for 5 min/);
    alice.s.chat('global', 'can you hear me');
    await sleep(200);
    expect(alice.lines.at(-1)?.text).toMatch(/You are muted for 5 more minute/);
    expect((await call<{ lines: { text: string }[] }>('/api/admin/chat', boss.cookie)).data.lines.some((l) => l.text === 'can you hear me')).toBe(false);
    await call('/api/admin/moderate', boss.cookie, { action: 'unmute', target: 'Alice' });
    alice.s.chat('global', 'back');
    await sleep(200);
    expect(alice.lines.at(-1)).toMatchObject({ channel: 'global', text: 'back', sent: true });

    // An event sets the world rates and announces itself; ending it resets them.
    const ev = await call<{ event: { id: string; state: string } }>('/api/admin/events', boss.cookie, { name: 'Double XP', rates: { xp: 2, gold: 1, drops: 1, respawn: 1 } });
    expect(ev.status).toBe(201);
    expect(ev.data.event.state).toBe('active');
    await sleep(200);
    expect((await call<{ rates: { xp: number } }>('/api/admin/overview', boss.cookie)).data.rates.xp).toBe(2);
    expect(alice.lines.some((l) => l.kind === 'admin' && /Double XP" has begun: XP ×2 for 60 min/.test(l.text))).toBe(true);
    await call('/api/admin/events/cancel', boss.cookie, { id: ev.data.event.id });
    expect((await call<{ rates: { xp: number } }>('/api/admin/overview', boss.cookie)).data.rates.xp).toBe(1);

    // A custom spawn next to Alice: named, scaled, listed, removed.
    const sp = await call<{ spawn: { id: string; count: number; zone: string } }>('/api/admin/spawns', boss.cookie, {
      zone: 'synthetic-arena', archetype: 'skeleton_warrior', count: 2, name: 'Big Bones', at: { player: 'Alice' }, hp: 500, scale: 2, damage: 0.5, speed: 1.5, minutes: 5,
    });
    expect(sp.status).toBe(201);
    expect(sp.data.spawn).toMatchObject({ count: 2, zone: 'synthetic-arena' });
    for (let i = 0; i < 20 && alice.spawns.filter((x) => x.name === 'Big Bones').length < 2; i++) {
      alice.s.tick({ clientTick: 0, flags: 0, yaw: 0, pitch: 0 });
      await sleep(50);
    }
    const big = alice.spawns.filter((x) => x.name === 'Big Bones');
    expect(big).toHaveLength(2);
    expect(big[0]!.info).toMatchObject({ maxHp: 500, scale: 2, archetype: 'skeleton_warrior' });
    expect((await call<{ spawns: { alive: number }[] }>('/api/admin/spawns', boss.cookie)).data.spawns).toMatchObject([{ alive: 2 }]);
    expect((await call('/api/admin/spawns/remove', boss.cookie, { id: sp.data.spawn.id })).status).toBe(200);
    expect((await call<{ spawns: unknown[] }>('/api/admin/spawns', boss.cookie)).data.spawns).toEqual([]);
    expect((await call<{ message: string }>('/api/admin/spawns', boss.cookie, { zone: 'synthetic-arena', archetype: 'no_such_thing', at: { start: true } })).status).toBe(400);

    // Player tools.
    expect((await call<{ message: string }>('/api/admin/player', boss.cookie, { action: 'gold', target: 'alice', amount: 250 })).data.message).toMatch(/Alice now has \d+ gold/);

    // A ban kicks the player and keeps the account out until lifted.
    expect((await call<{ message: string }>('/api/admin/moderate', boss.cookie, { action: 'ban', target: 'Alice', reason: 'cheating' })).data.message).toBe('Alice banned permanently.');
    await sleep(300);
    expect(alice.s.connected).toBe(false);
    expect(alice.closed()).toMatch(/banned permanently \(cheating\)/);
    const refused = await call<{ error: string; message: string }>('/api/auth/login', '', { username: 'alice', password: 'password123' });
    expect(refused.status).toBe(403);
    expect(refused.data.message).toMatch(/banned permanently \(cheating\)/);
    expect((await call('/api/admin/moderate', boss.cookie, { action: 'ban', target: 'Boss' })).status).toBe(400);
    await call('/api/admin/moderate', boss.cookie, { action: 'unban', target: 'Alice' });
    expect((await call('/api/auth/login', '', { username: 'alice', password: 'password123' })).status).toBe(200);

    const audit = await call<{ actions: { action: string }[] }>('/api/admin/log', boss.cookie);
    expect(audit.data.actions.map((a) => a.action)).toEqual(expect.arrayContaining(['chat.announce', 'mute', 'unmute', 'event.create', 'event.cancel', 'spawn', 'despawn', 'player.gold', 'ban', 'unban']));
  });
});
