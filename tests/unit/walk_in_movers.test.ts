import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT_PACKET_MAX_BYTES,
  LEVEL_UNIT_METRES,
  MOVER_BACK,
  MOVER_DONE,
  MOVER_FORWARD,
  MOVER_SHUT,
  TICK_MS,
  buildLevelArena,
  encodeInput,
  initPhysics,
  moverFromMotion,
  moverPose,
  quantizeAngle,
  reverseMover,
  shutMover,
  stepMover,
  useMover,
  worldTrigger,
  type LevelBrushMotion,
  type LevelPlacements,
  type MoverMotion,
  type Rapier,
  type StoryTrigger,
} from '@crusaders/shared';

/** The movers as converted (1.34), original units. */
const WHEEL: LevelBrushMotion = { flags: 0xc45, start: 0, delayMs: 0, types: [0x88], keys: [[-360, 770.5, -1583.5001]], speeds: [0.00006944444612599909, 1.5e-38] }; // Ci1b bBigWheel1
const GEAR: LevelBrushMotion = { flags: 0xd05, start: 0, delayMs: 0, types: [0x90], keys: [[-360, 2214, -1575.5]], speeds: [0.000027777776267612353, 1.5e-38] }; // Bs1a bgears02
const CHANDELIER: LevelBrushMotion = { flags: 0x4002401, start: 0, delayMs: 0, types: [0x88], keys: [[-10, 1069.5, -1536]], speeds: [0.00015, 0.0006] }; // Cs1b-Inn
const CRUSHER: LevelBrushMotion = { flags: 0x1002016, start: 0, delayMs: 0, types: [0x42], keys: [[0, -128, 0]], speeds: [0.00023437499476131052, 0.0021875000093132257] }; // Gl1b bStalagCrusher1

const FT = LEVEL_UNIT_METRES;
const dir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
const converted = (act: string) => {
  const file = path.join(dir, `${act}.placements.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as LevelPlacements) : null;
};

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

/** A zone on a converted act, without its creatures, and a way to read a brush's mover. */
function zoneOn(act: string, pl: LevelPlacements) {
  const arena = buildLevelArena(`level:${act}`, fs.readFileSync(path.join(dir, `${pl.mesh}.collision.bin`)), pl);
  arena.mobSpawns = [];
  const zone = new WorldZone(rapier, arena.name, arena, { send: () => {}, persist: () => {} }, { random: () => 0 });
  const objects = (zone as unknown as { objects: Map<number, { mover?: { motion: MoverMotion } }> }).objects;
  const mover = (name: string) => objects.get(arena.brushes!.find((b) => b.name === name)!.door!)!.mover!;
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let tick = 0;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      tick++;
      const len = encodeInput(buf, 0, [{ clientTick: tick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
    }
  };
  return { zone, arena, mover, step };
}

describe('walk-in movers', () => {
  it('read their contact flags from 0x48E370: gears pass through, the rest push', () => {
    expect(moverFromMotion(GEAR, FT)!.contact).toBe('none'); // 0x100
    expect(moverFromMotion(CRUSHER, FT)!.contact).toBe('push');
    expect(moverFromMotion({ ...CRUSHER, flags: 0x200 }, FT)!.contact).toBe('reverse');
    expect(moverFromMotion(WHEEL, FT)!.contact).toBe('push');
    expect(moverFromMotion(CHANDELIER, FT)!.contact).toBe('push');
    expect(moverFromMotion({ ...WHEEL, flags: 0x80 }, FT)!.contact).toBe('stop');
    const m = shutMover();
    m.state = MOVER_FORWARD;
    reverseMover(m);
    expect(m.state).toBe(MOVER_BACK);
    reverseMover(m);
    expect(m.state).toBe(MOVER_FORWARD);
  });

  it('wheels and gears turn for good once started (mode 5): a wheel a turn every 14.4 s, a gear every 36 s', () => {
    for (const [motion, seconds] of [[WHEEL, 14.4], [GEAR, 36]] as const) {
      const def = moverFromMotion(motion, FT)!;
      expect(def.mode).toBe(5);
      expect(def.ease).toBe('none'); // the garbage middle speed is never read
      const m = shutMover();
      expect(useMover(def, m)).toBe(true);
      const quarter = (seconds * 1000) / 4;
      stepMover(def, m, quarter);
      const angle = 2 * Math.atan2(Math.hypot(...moverPose(def, m).q.slice(0, 3)), moverPose(def, m).q[3]);
      expect((angle * 180) / Math.PI).toBeCloseTo(90, 0);
      for (let i = 0; i < (seconds * 3 * 1000) / TICK_MS; i++) stepMover(def, m, TICK_MS);
      expect(m.state).toBe(MOVER_FORWARD);
      expect(useMover(def, m)).toBe(false); // walking in again does nothing
    }
  });

  it('the chandelier swings ±5° for good (mode 1, eased)', () => {
    const def = moverFromMotion(CHANDELIER, FT)!;
    expect(def.mode).toBe(1);
    const m = shutMover();
    useMover(def, m);
    const states = new Set<number>();
    for (let i = 0; i < 20 * 60; i++) stepMover(def, m, TICK_MS), states.add(m.state);
    expect(states).toEqual(new Set([MOVER_FORWARD, MOVER_BACK]));
  });

  it('a crusher falls 128 ft once (mode 6), gathering speed (eased in), in ~1.1 s', () => {
    const def = moverFromMotion(CRUSHER, FT)!;
    expect(def.mode).toBe(6);
    expect(def.ease).toBe('in');
    const m = shutMover();
    useMover(def, m);
    let ms = 0;
    while (m.state === MOVER_FORWARD && ms < 10_000) stepMover(def, m, TICK_MS), (ms += TICK_MS);
    expect(m.state).toBe(MOVER_DONE);
    expect(ms / 1000).toBeCloseTo(Math.log(0.0021875 / 0.000234375) / (0.0021875 - 0.000234375) / 1000, 1); // ∫ dp / (a + (b - a) p)
    expect(moverPose(def, m).t[1] / FT).toBeCloseTo(-128, 3);
    expect(useMover(def, m)).toBe(false);
  });

  it('their walk-in relays, crushers (0x201) too, fire on every touch and save no flag', () => {
    const t: StoryTrigger = { id: 1, kind: 'relay', activation: 0x201, targets: [], brushes: ['bStalagCrusher1'] };
    expect(worldTrigger(t)).toBe(true);
    expect(worldTrigger({ ...t, activation: 1, brushes: ['bBigWheel1'] })).toBe(true);
  });

  it('every act: each walk-in mover has its one-op relay (converter 1.34)', () => {
    const want: Record<string, RegExp> = { ci1b: /^b(Big|Long)Wheel[12]$/, bs1a: /^bgears0[12]$/, 'cs1b-inn': /^bChandelier1$/, gl1b: /^bStalagCrusher\d$/ };
    for (const [act, re] of Object.entries(want)) {
      const pl = converted(act);
      if (!pl) return;
      const relays = pl.story!.triggers.filter((t) => t.kind === 'relay' && t.volume && t.brushes?.some((b) => re.test(b)));
      expect(relays.length, act).toBeGreaterThan(0);
      for (const t of relays) expect(worldTrigger(t), act).toBe(true);
    }
    // Cs4b-Inn's chandelier trigger has no volume: it never moves (as the original).
    const cs4 = converted('cs4b-inn');
    if (cs4) expect(cs4.story!.triggers.some((t) => t.brushes?.includes('bChandelier1'))).toBe(false);
  });

  it('Ci1b: walking under the wheels sets all four turning', () => {
    const pl = converted('ci1b');
    if (!pl) return;
    const { zone, mover, step } = zoneOn('ci1b', pl);
    // The four share one volume, x 1887-2204, z -1711..-1384, y 704-808 ft.
    const t = pl.story!.triggers.find((x) => x.brushes?.includes('bBigWheel1'))!;
    const [cx, cz] = t.volume!.polygon.reduce(([a, b], [x, z]) => [a + x / t.volume!.polygon.length, b + z / t.volume!.polygon.length], [0, 0]);
    expect(mover('bBigWheel1').motion.state).toBe(MOVER_SHUT);
    zone.join(1, { name: 'Walker', characterId: 'c1', position: { x: cx * FT, y: (t.volume!.yMin + 2) * FT, z: cz * FT }, hp: 30 });
    step(5);
    for (const name of ['bBigWheel1', 'bBigWheel2', 'bLongWheel1', 'bLongWheel2']) expect(mover(name).motion.state, name).toBe(MOVER_FORWARD);
    zone.leave(1);
    step(20 * 20);
    expect(mover('bBigWheel1').motion.state).toBe(MOVER_FORWARD); // still turning with nobody there
  });

  it('Gl1b: a crusher that reaches a player holds on his head, hurting nobody, and falls on once he is gone', () => {
    const pl = converted('gl1b');
    if (!pl) return;
    const { zone, mover, step } = zoneOn('gl1b', pl);
    // bStalagCrusher1 hangs at x 2100-2108, z -988..-979, tip 840 ft; its volume is under it.
    const id = zone.join(1, { name: 'Walker', characterId: 'c1', position: { x: 2104 * FT, y: 760 * FT, z: -984 * FT }, hp: 30 });
    const me = () => zone.inspect().find((a) => a.id === id)!;
    step(20 * 3);
    const m = mover('bStalagCrusher1').motion;
    expect(m.state).toBe(MOVER_FORWARD);
    expect(m.blocked).toBe(true);
    expect(m.progress).toBeGreaterThan(0.3);
    expect(m.progress).toBeLessThan(1);
    expect(me().hp).toBe(30);
    zone.leave(1);
    step(20 * 2);
    expect(m.state).toBe(MOVER_DONE);
    expect(m.blocked).toBe(false);
  });

  it('Gl1b: a crusher set off and left falls to the floor for good', () => {
    const pl = converted('gl1b');
    if (!pl) return;
    const { zone, mover, step } = zoneOn('gl1b', pl);
    zone.join(1, { name: 'Walker', characterId: 'c1', position: { x: 2104 * FT, y: 760 * FT, z: -984 * FT }, hp: 30 });
    step(3);
    zone.leave(1);
    step(20 * 6);
    expect(mover('bStalagCrusher1').motion.state).toBe(MOVER_DONE);
    expect(mover('bStalagCrusher2').motion.state).toBe(MOVER_SHUT); // nobody went under it
  });
});
