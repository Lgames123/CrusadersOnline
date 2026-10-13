import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  ANIM,
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
function npcZone(archetype: string, hp: number, wander = false, bystander?: { archetype: string; x: number; z: number }) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ archetype, x: 0, y: 0.5, z: -1.2, hp, ...(wander ? { wander } : {}) }];
  if (bystander) arena.mobSpawns.push({ archetype: bystander.archetype, x: bystander.x, y: 0.5, z: bystander.z, hp: 20 });
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
  const mobs = () => zone.inspect().filter((a) => a.kind === 'mob');
  const npc = () => mobs()[0]!;
  const events = () => messages.filter((m) => m.op === SC.COMBAT_EVENT).map((m) => m.d as CombatEvent);
  return { zone, run, npc, mobs, events, me };
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

  it('a hit citizen does not flinch or fight back: on the alert, then it runs off', () => {
    const t = npcZone('npc_118', 20);
    t.zone.attack(1);
    const anims = new Set<number>();
    let far = 0;
    t.run(20 * 8, () => {
      const n = t.npc();
      anims.add(n.anim);
      far = Math.max(far, Math.hypot(n.x, n.z));
    });
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    expect(t.events().some((e) => e.target === t.me)).toBe(false);
    expect(anims.has(ANIM.HIT)).toBe(false);
    expect(anims.has(ANIM.ALERT)).toBe(true);
    expect(anims.has(ANIM.RUN)).toBe(true);
    expect(far).toBeGreaterThan(6);
  });

  it('citizens nearby run from an assault on someone else', () => {
    const t = npcZone('npc_114', 250, false, { archetype: 'npc_118', x: 5, z: 0 });
    let far = 0;
    t.zone.attack(1);
    t.run(20 * 6, () => {
      const b = t.mobs()[1]!;
      far = Math.max(far, Math.hypot(b.x, b.z));
    });
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    expect(t.mobs()[1]!.hp).toBe(20);
    expect(far).toBeGreaterThan(9);
  });

  it('a guard fights back once hit', () => {
    const t = npcZone('npc_114', 250);
    t.zone.attack(1);
    t.run(20 * 10);
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    expect(t.events().some((e) => e.target === t.me)).toBe(true);
  });
});
