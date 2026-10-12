import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT_PACKET_MAX_BYTES,
  SC,
  createSyntheticArena,
  encodeInput,
  initPhysics,
  quantizeAngle,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

type CombatEvent = Extract<ServerControlMsg, { op: typeof SC.COMBAT_EVENT }>['d'];

/** A player at the origin facing -Z and one peaceful creature 1.2 m ahead (the arena's skeletons removed). */
function npcZone(archetype: string, hp: number, wander = false) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ archetype, x: 0, y: 0.5, z: -1.2, hp, ...(wander ? { wander } : {}) }];
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'npc', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => 0.5 });
  const me = zone.join(1, { name: 'Tester', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let tick = 0;
  const run = (ticks: number, each?: (i: number) => void) => {
    for (let i = 0; i < ticks; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++tick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      each?.(i);
      zone.step();
    }
  };
  const npc = () => zone.inspect().find((a) => a.kind === 'mob')!;
  const events = () => messages.filter((m) => m.op === SC.COMBAT_EVENT).map((m) => m.d as CombatEvent);
  return { zone, run, npc, events, me };
}

describe('peaceful creatures (NPCs)', () => {
  it('stand still without aggro, a citizen strolls about its place', () => {
    const guard = npcZone('npc_114', 250);
    guard.run(200);
    expect(guard.events()).toEqual([]);
    const start = { ...guard.npc() };
    expect(Math.hypot(start.x, start.z + 1.2)).toBeLessThan(0.3);
    const citizen = npcZone('npc_118', 20, true);
    let moved = 0;
    citizen.run(20 * 30, () => {
      const n = citizen.npc();
      moved = Math.max(moved, Math.hypot(n.x, n.z + 1.2));
    });
    expect(moved).toBeGreaterThan(0.5);
    expect(moved).toBeLessThan(4.5);
  });

  it('a citizen takes hits and dies, without fighting back', () => {
    const t = npcZone('npc_118', 20);
    t.run(400, (i) => i % 10 === 0 && t.zone.attack(1));
    const onNpc = t.events().filter((e) => e.target === t.npc().id);
    expect(onNpc.some((e) => e.damage > 0)).toBe(true);
    expect(onNpc.some((e) => e.killed)).toBe(true);
    expect(t.events().some((e) => e.target === t.me)).toBe(false);
  });

  it('a guard fights back once hit', () => {
    const t = npcZone('npc_114', 250);
    t.zone.attack(1);
    t.run(20 * 10);
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    expect(t.events().some((e) => e.target === t.me)).toBe(true);
  });
});
