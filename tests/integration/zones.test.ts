import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@crusaders/server';
import { packCollision } from '@crusaders/converter/emit/gltf_level';
import {
  ClientSession,
  INPUT,
  LEVEL_UNIT_METRES,
  buildLevelArena,
  initPhysics,
  quantizeAngle,
  type ArenaDef,
  type InputFrame,
  type LevelPlacements,
  type Rapier,
} from '@crusaders/shared';
import { backends, type TestDatabase } from './db_backends.ts';

/**
 * Zone transfers through level portals, on two tiny levels written here (a flat floor and a
 * portal each; no original data involved).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rapier: Rapier;
let dir: string;
const collision = packCollision([-100, 0, 100, 100, 0, 100, 100, 0, -100, -100, 0, -100], [0, 1, 2, 0, 2, 3]);
const arenas: Record<string, ArenaDef> = {};

beforeAll(async () => {
  rapier = await initPhysics();
  dir = await mkdtemp(path.join(tmpdir(), 'crusaders-zones-'));
  await mkdir(path.join(dir, 'levels'));
  await writeFile(path.join(dir, 'levels', 'flat.collision.bin'), collision);
  // Spawn point of the flat floor (no hostiles: the largest floor triangle), in feet.
  const probe = buildLevelArena('probe', collision, { mesh: 'flat', creatures: [] });
  const sp = probe.spawnPoints[0]!;
  const ft = (m: number) => m / LEVEL_UNIT_METRES;
  // za: exit 4 m straight ahead (-Z, yaw 0) of the spawn; zb: the way back, off to the side.
  const levels: Record<string, LevelPlacements> = {
    za: { mesh: 'flat', creatures: [], portals: [{ exit: 0, target: 'zb', position: [ft(sp.x), 0, ft(sp.z - 4)] }] },
    zb: { mesh: 'flat', creatures: [], portals: [{ exit: 0, target: 'za', position: [ft(sp.x + 8), 0, ft(sp.z)] }] },
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
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? cookie, data: (await res.json()) as { ticket: string } };
}

/** A client that loads whatever zone the server announces (like the browser client). */
async function play(port: number, cookie: string): Promise<ClientSession> {
  const t = await call(port, '/api/ws-ticket', cookie);
  const s: ClientSession = new ClientSession(rapier, arenas['level:za']!, {
    zone: (name) => {
      s.setArena(arenas[name]!);
      s.zoneReady(name);
    },
  });
  await s.connect(`ws://127.0.0.1:${port}/ws`, t.data.ticket, 10_000);
  return s;
}

async function walk(s: ClientSession, flags: number, ticks: number, until?: () => boolean): Promise<void> {
  const input: InputFrame = { clientTick: 0, flags, yaw: quantizeAngle(0), pitch: 0 };
  for (let i = 0; i < ticks && !until?.(); i++) {
    if (s.character) s.tick(input);
    await sleep(50);
  }
}

describe.each(backends)('zone transfers through portals on $name', (backend) => {
  let server: RunningServer;
  let db: TestDatabase;
  beforeAll(async () => {
    db = await backend.create();
    server = await startServer({ port: 0, host: '127.0.0.1', env: 'test', logLevel: 'silent', httpBurst: 1000, databaseUrl: db.url, arena: 'level:za', generatedDir: dir });
  });
  afterAll(async () => {
    await server.close();
    await db.dispose();
  });

  it('walks through a portal into the next zone, arrives at the way back and resumes there', async () => {
    const reg = await call(server.port, '/api/auth/register', '', { username: 'Traveller', password: 'password123' });
    const s = await play(server.port, reg.cookie);
    expect(s.arenaName).toBe('level:za');
    const start = { ...s.character!.position };

    await walk(s, INPUT.FORWARD, 60, () => s.arenaName === 'level:zb' && !!s.character);
    expect(s.arenaName).toBe('level:zb');
    await walk(s, 0, 10);
    // Arrived next to zb's portal back to za, outside its trigger: no immediate bounce.
    const back = arenas['level:zb']!.portals![0]!;
    const p = s.character!.position;
    expect(Math.hypot(p.x - back.x, p.z - back.z)).toBeLessThan(4);
    expect(Math.hypot(p.x - back.x, p.z - back.z)).toBeGreaterThan(1.6);
    await walk(s, 0, 20);
    expect(s.arenaName).toBe('level:zb');
    // State carried over: the starting kit is still there.
    expect(s.inventory?.items.map((i) => i.itemId)).toEqual(['axe', 'wooden_shield']);
    s.close();
    await sleep(400);

    // The character was saved in zb: the next login resumes there.
    const again = await play(server.port, reg.cookie);
    expect(again.arenaName).toBe('level:zb');
    expect(Math.hypot(again.character!.position.x - start.x, again.character!.position.z - start.z)).toBeGreaterThan(1);
    again.close();
  });
});
