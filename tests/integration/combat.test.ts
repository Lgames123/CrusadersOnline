import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@crusaders/server';
import { ClientSession, INPUT, MOB_ARCHETYPES, createSyntheticArena, initPhysics, quantizeAngle, type InputFrame, type Rapier } from '@crusaders/shared';
import { backends, type TestDatabase } from './db_backends.ts';

const arena = createSyntheticArena();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SKELETON = MOB_ARCHETYPES['skeleton_warrior']!;
let rapier: Rapier;

beforeAll(async () => {
  rapier = await initPhysics();
});

async function call(port: number, route: string, cookie = '', body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie, data: (await res.json()) as { ticket: string } };
}

describe.each(backends)('vertical-slice combat over the network on $name (M08)', (backend) => {
  let server: RunningServer;
  let db: TestDatabase;
  beforeAll(async () => {
    db = await backend.create();
    server = await startServer({ port: 0, host: '127.0.0.1', env: 'test', logLevel: 'silent', databaseUrl: db.url, httpBurst: 1000 });
  });
  afterAll(async () => {
    await server.close();
    await db.dispose();
  });

  it('kills the skeleton, earns XP and gold, and keeps them after reconnecting', async () => {
    const reg = await call(server.port, '/api/auth/register', '', { username: 'Slayer', password: 'password123' });
    const play = async () => {
      const t = await call(server.port, '/api/ws-ticket', reg.cookie);
      const s = new ClientSession(rapier, arena);
      await s.connect(`ws://127.0.0.1:${server.port}/ws`, t.data.ticket);
      return s;
    };

    const s = await play();
    const input: InputFrame = { clientTick: 0, flags: INPUT.FORWARD, yaw: quantizeAngle(0), pitch: 0 };
    for (let i = 0; i < 20; i++) {
      s.tick(input);
      await sleep(50);
    }
    input.flags = 0;
    const mobId = [...s.entities.values()].find((e) => e.kind === 'mob' && e.archetype === 'skeleton_warrior')?.id;
    expect(mobId).toBeDefined();

    let killed = false;
    for (let i = 0; i < 200 && !killed; i++) {
      s.tick(input);
      if (i % 4 === 0) s.attack();
      await sleep(50);
      killed = s.combatLog.some((e) => e.target === mobId && e.killed);
    }
    expect(killed).toBe(true);
    await sleep(200);
    expect(s.playerStats).toMatchObject({ xp: SKELETON.xpReward, level: 1 });
    const gold = s.playerStats!.gold;
    expect(gold).toBeGreaterThanOrEqual(SKELETON.goldMin);
    // Lower the shield: the change must survive the reconnect (inventory_items).
    const shield = s.inventory!.items.find((i) => i.type === 'shield')!;
    s.equip(shield.slot, false);
    await sleep(200);
    expect(s.inventory!.items.find((i) => i.slot === shield.slot)!.equipped).toBe(false);
    const items = s.inventory!.items.map((i) => [i.itemId, i.slot, i.equipped]);
    s.close();
    await sleep(300);

    const again = await play();
    await sleep(200);
    expect(again.playerStats).toMatchObject({ xp: SKELETON.xpReward, gold });
    expect(again.inventory!.items.map((i) => [i.itemId, i.slot, i.equipped])).toEqual(items);
    again.close();
  });
});
