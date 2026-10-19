import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT_PACKET_MAX_BYTES,
  LEVEL_UNIT_METRES,
  buildLevelArena,
  encodeInput,
  quantizeAngle,
  type LevelPlacements,
  DEFAULT_MOVEMENT_STATS,
  MOVER_BACK,
  MOVER_FORWARD,
  TICK_DT,
  TICK_MS,
  carryOnBrush,
  createCharacter,
  createInputFrame,
  createMovementWorld,
  initPhysics,
  moverFromMotion,
  moverPose,
  setBrushPose,
  setCharacterState,
  shutMover,
  stepCharacter,
  stepMover,
  useMover,
  worldTrigger,
  type ArenaDef,
  type LevelBrushMotion,
  type StoryTrigger,
} from '@crusaders/shared';

/** Ca1b bBridgePiece4's mover as converted (1.32): a -10° turn about Z through (3347.76, 1269.71) ft, eased ping-pong. */
const BRIDGE: LevelBrushMotion = { flags: 0x4002c01, start: 0, delayMs: 0, types: [0xa0], keys: [[-10, 3347.7595, 1269.7086]], speeds: [0.00006, 0.0009] };

describe("Ca*b's swinging bridges", () => {
  it('swing back and forth for good once walked into (mode 1)', () => {
    const def = moverFromMotion(BRIDGE, 1)!;
    const m = shutMover();
    expect(useMover(def, m)).toBe(true);
    const states = new Set<number>();
    let min = 0;
    for (let i = 0; i < 60 * 30; i++) {
      stepMover(def, m, TICK_MS);
      states.add(m.state);
      const { q } = moverPose(def, m);
      min = Math.min(min, 2 * Math.asin(q[2]));
    }
    expect(states).toEqual(new Set([MOVER_FORWARD, MOVER_BACK]));
    expect((min * 180) / Math.PI).toBeCloseTo(-10, 1);
    // A walk-in trigger hitting a moving bridge again does nothing.
    expect(useMover(def, m)).toBe(false);
  });

  it('their walk-in relay fires on every touch, saving no flag; a walk-in relay with a sound does not', () => {
    const t: StoryTrigger = { id: 1, kind: 'relay', activation: 1, targets: [], brushes: ['bBridgePiece4'] };
    expect(worldTrigger(t)).toBe(true);
    expect(worldTrigger({ ...t, sounds: [{ id: 1, positions: [], volume: 1 }] })).toBe(false); // Ws9a's cell door
    expect(worldTrigger({ ...t, activation: 0x201 })).toBe(false);
  });

  it('carry whoever stands on them', async () => {
    // A 4 x 4 m deck at y 0 hung from a pivot 10 m up.
    const pts = [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]].flatMap(([x, y, z]) => [x!, y!, z!, x!, y! - 0.2, z!]);
    const arena: ArenaDef = { name: 'test', boxes: [], meshes: [], spawnPoints: [], mobSpawns: [], brushes: [{ name: 'bBridgePiece1', points: new Float32Array(pts), solid: true, door: 7 }] };
    const mw = createMovementWorld(await initPhysics(), arena);
    const c = createCharacter(mw, { x: 0, y: 0, z: 0 });
    const idle = createInputFrame();
    for (let i = 0; i < 10; i++) stepCharacter(mw, c, idle, DEFAULT_MOVEMENT_STATS, TICK_DT);
    expect(c.grounded).toBe(true);
    const def = moverFromMotion({ ...BRIDGE, keys: [[-10, 0, 10]] }, 1)!;
    const m = shutMover();
    useMover(def, m);
    for (let i = 0; i < 30; i++) {
      const from = moverPose(def, m);
      stepMover(def, m, TICK_MS);
      const to = moverPose(def, m);
      setBrushPose(mw, 7, to.t, to.q);
      carryOnBrush(mw, c, mw.doors.get(7)!, from, to);
      stepCharacter(mw, c, idle, DEFAULT_MOVEMENT_STATS, TICK_DT);
    }
    // The feet went with the deck point under them: rotated about (0, 10) in x / y.
    const { t, q } = moverPose(def, m);
    const a = 2 * Math.asin(q[2]);
    expect(a).toBeLessThan(-0.01);
    expect(c.position.x).toBeCloseTo(t[0], 1);
    expect(c.grounded).toBe(true);
    // Off the deck nothing is carried.
    setCharacterState(c, { x: 10, y: 0, z: 0 }, 0, true);
    expect(carryOnBrush(mw, c, mw.doors.get(7)!, moverPose(def, m), moverPose(def, m))).toBeNull();
  });

  it('Ca1b: a player standing on bBridgePiece4 swings with it and never falls into the pit', async () => {
    const dir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(dir)) return;
    const pl = JSON.parse(fs.readFileSync(path.join(dir, 'ca1b.placements.json'), 'utf8')) as LevelPlacements;
    expect(pl.brushes!.filter((b) => /^bBridgePiece[45]$/.test(b.name) && b.motion)).toHaveLength(2);
    const arena = buildLevelArena('level:ca1b', fs.readFileSync(path.join(dir, `${pl.mesh}.collision.bin`)), pl);
    const ft = LEVEL_UNIT_METRES;
    const zone = new WorldZone(await initPhysics(), arena.name, arena, { send: () => {}, persist: () => {} }, { random: () => 0 });
    // The middle of piece 4's deck at rest (x 3352-3368, z -2686..-2750 ft, boards ~1130 ft, rails to 1141).
    const id = zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 3360 * ft, y: 1142 * ft, z: -2718 * ft }, hp: 30 });
    const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    let minX = Infinity, maxX = -Infinity, minY = Infinity;
    for (let tick = 1; tick <= 400; tick++) {
      const len = encodeInput(buf, 0, [{ clientTick: tick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
      const me = zone.inspect().find((a) => a.id === id)!;
      if (tick > 20) (minX = Math.min(minX, me.x / ft)), (maxX = Math.max(maxX, me.x / ft)), (minY = Math.min(minY, me.y / ft));
    }
    // Walked in, the bridge swings ±5° about its pivot 130 ft up: ~23 ft across, and he rides it.
    expect(maxX - minX).toBeGreaterThan(18);
    expect(minY).toBeGreaterThan(1125); // the deck boards, ~1129.5 ft; the pit floor is below 850
  });
});
