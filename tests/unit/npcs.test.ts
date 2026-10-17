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

type Spawn = ReturnType<typeof createSyntheticArena>['mobSpawns'][number];

/** A player at the origin facing -Z and one peaceful creature 1.2 m ahead (the arena's skeletons removed). */
function npcZone(archetype: string, hp: number, extra: Partial<Spawn> = {}, bystander?: { archetype: string; x: number; z: number } & Partial<Spawn>, at = { x: 0, z: 0 }) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ archetype, x: 0, y: 0.5, z: -1.2, hp, ...extra }];
  if (bystander) arena.mobSpawns.push({ hp: 20, ...bystander, y: 0.5 });
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'npc', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => 0.5 });
  const me = zone.join(1, { name: 'Tester', characterId: null, position: { x: at.x, y: 0.5, z: at.z } });
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
  it('stand still without aggro (idle behaviour kind 0), however they are placed', () => {
    const guard = npcZone('npc_114', 250);
    guard.run(200);
    expect(guard.events()).toEqual([]);
    expect(Math.hypot(guard.npc().x, guard.npc().z + 1.2)).toBeLessThan(0.3);
    // A citizen without a path stands too (the Ws9a prisoner no longer walks into the wall).
    const citizen = npcZone('npc_118', 20, {}, undefined, { x: 30, z: 30 });
    citizen.run(20 * 30);
    expect(Math.hypot(citizen.npc().x, citizen.npc().z + 1.2)).toBeLessThan(0.3);
  });

  it('a citizen with a path walks it point by point, back and forth, pausing at each', () => {
    const path = { points: [{ x: 0, y: 0.5, z: -1.2 }, { x: 4, y: 0.5, z: -1.2 }, { x: 4, y: 0.5, z: -5.2 }], pause: 1000, loop: false };
    const t = npcZone('npc_118', 20, { path }, undefined, { x: -30, z: 30 });
    const reached = new Set<number>();
    let order: number[] = [];
    t.run(20 * 40, () => {
      const n = t.npc();
      path.points.forEach((p, i) => {
        if (Math.hypot(n.x - p.x, n.z - p.z) < 0.5 && order.at(-1) !== i) {
          reached.add(i);
          order.push(i);
        }
      });
    });
    expect([...reached].sort()).toEqual([0, 1, 2]);
    // Back and forth: 0 1 2 1 0 1 ...
    order = order.slice(0, 5);
    expect(order).toEqual([0, 1, 2, 1, 0]);
  });

  it('stops and faces a player who comes within 12 ft, and goes on once he is beyond 20 ft', () => {
    const path = { points: [{ x: 0, y: 0.5, z: -1.2 }, { x: 0, y: 0.5, z: -12 }], pause: 0, loop: false };
    const t = npcZone('npc_118', 20, { path });
    t.run(40);
    const n = t.npc();
    expect(Math.hypot(n.x, n.z + 1.2)).toBeLessThan(0.3); // held at the first point by the player 1.2 m away
    const want = Math.atan2(-(0 - n.x), -(0 - n.z));
    expect(Math.abs(Math.atan2(Math.sin(n.yaw - want), Math.cos(n.yaw - want)))).toBeLessThan(0.15);
  });

  it('a hit citizen flinches, does not fight back, stands on the alert, then runs off', () => {
    const t = npcZone('npc_118', 20);
    t.zone.attack(1);
    const anims: number[] = [];
    let far = 0;
    t.run(20 * 8, () => {
      const n = t.npc();
      if (anims.at(-1) !== n.anim) anims.push(n.anim);
      far = Math.max(far, Math.hypot(n.x, n.z));
    });
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    expect(t.events().some((e) => e.target === t.me)).toBe(false);
    // As logged: ASM_IMPACT_*, ASM_COMBAT_STANDING, ASM_RUNNING.
    const hit = anims.indexOf(ANIM.HIT);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(anims.indexOf(ANIM.ALERT)).toBeGreaterThan(hit);
    expect(anims.indexOf(ANIM.RUN)).toBeGreaterThan(anims.indexOf(ANIM.ALERT));
    expect(far).toBeGreaterThan(6);
  });

  it('citizens who see the player strike a peaceful creature run from him', () => {
    const t = npcZone('npc_114', 250, {}, { archetype: 'npc_118', x: 15, z: 0 });
    let far = 0;
    t.zone.attack(1);
    t.run(20 * 6, () => {
      const b = t.mobs()[1]!;
      far = Math.max(far, Math.hypot(b.x, b.z));
    });
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    expect(t.mobs()[1]!.hp).toBe(20);
    expect(far).toBeGreaterThan(19);
  });

  it('striking a peaceful creature alarms the guards who see it (0x40F890 / 0x40D910)', () => {
    const t = npcZone('npc_118', 20, {}, { archetype: 'npc_114', x: 15, z: 0, hp: 250 });
    t.zone.attack(1);
    t.run(20 * 12);
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    // The guard 15 m away came and fought the player.
    expect(t.events().some((e) => e.attacker === t.mobs()[1]!.id && e.target === t.me)).toBe(true);
  });

  it('a placement holds its own items: none means unarmed', () => {
    const t = npcZone('npc_114', 250, { placement: 0, weapon: null, shield: null });
    t.zone.attack(1);
    t.run(20 * 10);
    // An Old Guard holding nothing does not fight back: it runs like a citizen.
    expect(t.events().some((e) => e.target === t.me)).toBe(false);
  });

  it('a guard fights back once hit', () => {
    const t = npcZone('npc_114', 250);
    t.zone.attack(1);
    t.run(20 * 10);
    expect(t.events().some((e) => e.target === t.npc().id && e.damage > 0)).toBe(true);
    expect(t.events().some((e) => e.target === t.me)).toBe(true);
  });

  it('talked to, a citizen stops, gestures through the line and turns to face the player', () => {
    const t = npcZone('npc_118', 20, {}, { archetype: 'npc_118', x: 30, z: 30 });
    t.run(5);
    t.zone.talk(1, t.npc().id, 2000);
    t.run(1);
    const at = { x: t.npc().x, z: t.npc().z };
    const anims = new Set<number>();
    t.run(20 * 2 - 3, () => anims.add(t.npc().anim));
    expect([...anims]).toEqual([ANIM.GESTURE]);
    expect(Math.hypot(t.npc().x - at.x, t.npc().z - at.z)).toBeLessThan(0.05); // stands still
    // Turned to face the player at the origin (yaw 0 faces -Z).
    const n = t.npc();
    const want = Math.atan2(-(0 - n.x), -(0 - n.z));
    expect(Math.abs(Math.atan2(Math.sin(n.yaw - want), Math.cos(n.yaw - want)))).toBeLessThan(0.1);
    t.run(10);
    expect(t.npc().anim).not.toBe(ANIM.GESTURE);
    // Out of reach: no talk.
    t.zone.talk(1, t.mobs()[1]!.id, 2000);
    t.run(2);
    expect(t.mobs()[1]!.anim).not.toBe(ANIM.GESTURE);
  });

  it('a placed creature without a line says nothing', () => {
    const t = npcZone('npc_118', 20, { placement: 0 });
    t.run(5);
    t.zone.talk(1, t.npc().id, 2000);
    t.run(3);
    expect(t.npc().anim).not.toBe(ANIM.GESTURE);
  });
});
