import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@crusaders/server';
import { packCollision } from '@crusaders/converter/emit/gltf_level';
import { ClientSession, INPUT, LEVEL_UNIT_METRES, quantizeAngle, buildLevelArena, initPhysics, type ArenaDef, type ChatBroadcastMsg, type LevelPlacements, type Rapier } from '@crusaders/shared';
import { backends, type TestDatabase } from './db_backends.ts';

/** Chat routing: local lines stay in their zone, global ones reach every zone, private ones one character. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rapier: Rapier;
let dir: string;
const collision = packCollision([-100, 0, 100, 100, 0, 100, 100, 0, -100, -100, 0, -100], [0, 1, 2, 0, 2, 3]);
const arenas: Record<string, ArenaDef> = {};

beforeAll(async () => {
  rapier = await initPhysics();
  dir = await mkdtemp(path.join(tmpdir(), 'crusaders-chat-'));
  await mkdir(path.join(dir, 'levels'));
  await writeFile(path.join(dir, 'levels', 'flat.collision.bin'), collision);
  const probe = buildLevelArena('probe', collision, { mesh: 'flat', creatures: [] });
  const sp = probe.spawnPoints[0]!;
  const ft = (m: number) => m / LEVEL_UNIT_METRES;
  // ca: a portal 4 m ahead of the spawn leads to cb; cb's way back is far off to the side.
  const levels: Record<string, LevelPlacements> = {
    ca: { mesh: 'flat', creatures: [], portals: [{ exit: 0, target: 'cb', position: [ft(sp.x), 0, ft(sp.z - 4)] }] },
    cb: { mesh: 'flat', creatures: [], portals: [{ exit: 0, target: 'ca', position: [ft(sp.x + 40), 0, ft(sp.z)] }] },
  };
  for (const [act, p] of Object.entries(levels)) {
    await writeFile(path.join(dir, 'levels', `${act}.placements.json`), JSON.stringify(p));
    arenas[`level:${act}`] = buildLevelArena(`level:${act}`, collision, p);
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function call(port: number, route: string, cookie = '', body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? cookie, data: (await res.json()) as { ticket: string } };
}

type Line = ChatBroadcastMsg['d'];

describe.each(backends.slice(0, 1))('chat on $name', (backend) => {
  let server: RunningServer;
  let db: TestDatabase;
  beforeAll(async () => {
    db = await backend.create();
    server = await startServer({ port: 0, host: '127.0.0.1', env: 'test', logLevel: 'silent', httpBurst: 1000, databaseUrl: db.url, arena: 'level:ca', generatedDir: dir });
  });
  afterAll(async () => {
    await server.close();
    await db.dispose();
  });

  /** Registers `name` and enters the world (the server's default arena, ca). */
  async function join(name: string): Promise<{ s: ClientSession; lines: Line[] }> {
    const reg = await call(server.port, '/api/auth/register', '', { username: name, password: 'password123' });
    const t = await call(server.port, '/api/ws-ticket', reg.cookie);
    const lines: Line[] = [];
    const s: ClientSession = new ClientSession(rapier, arenas['level:ca']!, {
      zone: (arena) => {
        s.setArena(arenas[arena]!);
        s.zoneReady(arena);
      },
      chat: (d) => lines.push(d),
    });
    await s.connect(`ws://127.0.0.1:${server.port}/ws`, t.data.ticket, 10_000);
    return { s, lines };
  }

  it('routes local, global and private lines', async () => {
    const alice = await join('Alice');
    const bob = await join('Bob');
    const carol = await join('Carol');
    // Carol walks through the portal into cb.
    const input = { clientTick: 0, flags: INPUT.FORWARD, yaw: quantizeAngle(0), pitch: 0 };
    for (let i = 0; i < 80 && carol.s.arenaName !== 'level:cb'; i++) {
      if (carol.s.character) carol.s.tick(input);
      await sleep(50);
    }
    expect(carol.s.arenaName).toBe('level:cb');
    await sleep(300);
    const said = (l: Line[]) => l.filter((x) => x.channel !== 'system');

    alice.s.chat('local', 'hello map');
    await sleep(200);
    expect(said(alice.lines)).toEqual([{ channel: 'local', from: 'Alice', text: 'hello map', sent: true }]);
    expect(said(bob.lines)).toEqual([{ channel: 'local', from: 'Alice', text: 'hello map' }]);
    expect(said(carol.lines)).toEqual([]);

    bob.s.chat('global', 'hello\u202Eworld');
    await sleep(200);
    for (const p of [alice, carol]) expect(said(p.lines).at(-1)).toEqual({ channel: 'global', from: 'Bob', text: 'hello world' });
    expect(said(bob.lines).at(-1)).toEqual({ channel: 'global', from: 'Bob', text: 'hello world', sent: true });

    alice.s.chat('private', 'psst', 'carol');
    await sleep(200);
    expect(said(carol.lines).at(-1)).toEqual({ channel: 'private', from: 'Alice', to: 'Carol', text: 'psst' });
    expect(said(alice.lines).at(-1)).toEqual({ channel: 'private', from: 'Alice', to: 'Carol', text: 'psst', sent: true });
    expect(said(bob.lines).at(-1)?.channel).toBe('global');

    alice.s.chat('private', 'anyone?', 'Nobody');
    await sleep(200);
    expect(alice.lines.at(-1)).toEqual({ channel: 'system', kind: 'error', text: 'Nobody is not online.' });

    // A burst past the chat budget (5) is refused with a notice, not a disconnect.
    for (let i = 0; i < 7; i++) bob.s.chat('local', `spam ${i}`);
    await sleep(300);
    expect(bob.lines.filter((l) => l.kind === 'error').length).toBeGreaterThan(0);
    expect(bob.s.connected).toBe(true);
    for (const p of [alice, bob, carol]) p.s.close();
  });
});
