import { describe, expect, it } from 'vitest';
import {
  MOVER_BACK,
  MOVER_DONE,
  MOVER_FORWARD,
  MOVER_PARKED,
  MOVER_SHUT,
  moverFromMotion,
  moverPose,
  rotate,
  shutMover,
  stepMover,
  useMover,
  type LevelBrushMotion,
} from '@crusaders/shared';

/** A one-key mover as read from an act (placements frame), 1 unit = 1 m here. */
const motion = (type: number, key: [number, number, number], flags: number, delayMs = 0, speed = 0.001): LevelBrushMotion => ({
  flags,
  start: 0,
  delayMs,
  types: [type],
  keys: [key],
  speeds: [speed, 0],
});

describe('keyframe mover (decompiled 0x48EC10 / 0x48EFC0 / 0x48FFC0 / 0x4900C0)', () => {
  it('a returning gate rises, waits its delay and comes back down shut (mode 0 + flag 8)', () => {
    // Ws9a bOuterGates: move segment 0x46, flags 0x4002048, 5000 ms.
    const def = moverFromMotion(motion(0x46, [0, 4, 0], 0x48, 5000), 1)!;
    const m = shutMover();
    expect(useMover(def, m)).toBe(true);
    expect(m.state).toBe(MOVER_FORWARD);
    stepMover(def, m, 1000); // 0.001 per ms: all the way up
    expect(m.state).toBe(MOVER_BACK);
    expect(moverPose(def, m).t[1]).toBeCloseTo(4);
    stepMover(def, m, 4000); // still waiting at the top
    expect(m.progress).toBe(1);
    stepMover(def, m, 1000 + 500);
    expect(m.progress).toBeCloseTo(0.5);
    stepMover(def, m, 600);
    expect(m.state).toBe(MOVER_SHUT);
    expect(moverPose(def, m).t[1]).toBeCloseTo(0);
  });

  it('modes: 2 parks at the end and is used again to go back, 6 is done for good, 5 loops', () => {
    const parks = moverFromMotion(motion(0x42, [1, 0, 0], 0x2), 1)!;
    const m = shutMover();
    useMover(parks, m);
    stepMover(parks, m, 2000);
    expect(m.state).toBe(MOVER_PARKED);
    expect(useMover(parks, m)).toBe(true);
    expect(m.state).toBe(MOVER_BACK);
    stepMover(parks, m, 2000);
    expect(m.state).toBe(MOVER_DONE); // mode 2 back at the start: done (0x48FFC0)

    const once = moverFromMotion(motion(0xa0, [40, 0, 1], 0x6), 1)!; // Ws9a lever
    const l = shutMover();
    useMover(once, l);
    stepMover(once, l, 2000);
    expect(l.state).toBe(MOVER_DONE);
    expect(useMover(once, l)).toBe(false);

    const loops = moverFromMotion(motion(0x88, [360, 0, 0], 0x5), 1)!; // wheels
    const w = shutMover();
    useMover(loops, w);
    stepMover(loops, w, 1500);
    expect(w.state).toBe(MOVER_FORWARD);
    expect(w.progress).toBeCloseTo(0.5, 1);
  });

  it('a blocked mover holds', () => {
    const def = moverFromMotion(motion(0x42, [1, 0, 0], 0x2), 1)!;
    const m = shutMover();
    useMover(def, m);
    m.blocked = true;
    stepMover(def, m, 500);
    expect(m.progress).toBe(0);
  });

  it('turns about X, Y and Z through their centres (0x48F630 / 0x48F960 / 0x48FC90)', () => {
    const half = { state: MOVER_FORWARD, key: 0, progress: 0.5, waitMs: 0 };
    // About Z through (x 1, y 2): the lever's (1, 3) end turns 90 deg to (0, 2).
    const z = moverFromMotion(motion(0x20, [180, 1, 2], 0x2), 1)!;
    const pz = moverPose(z, half);
    const a = rotate(pz.q, [1, 3, 0]);
    expect(a[0] + pz.t[0]).toBeCloseTo(0);
    expect(a[1] + pz.t[1]).toBeCloseTo(2);
    // About X through (y 0, z 5): (0, 1, 5) goes to (0, 0, 6).
    const x = moverFromMotion(motion(0x08, [180, 0, 5], 0x2), 1)!;
    const px = moverPose(x, half);
    const b = rotate(px.q, [0, 1, 5]);
    expect(b[1] + px.t[1]).toBeCloseTo(0);
    expect(b[2] + px.t[2]).toBeCloseTo(6);
    // About Y through (x 2, z 0): (3, 0, 0) goes to (2, 0, -1).
    const y = moverFromMotion(motion(0x10, [180, 2, 0], 0x2), 1)!;
    const py = moverPose(y, half);
    const c = rotate(py.q, [3, 0, 0]);
    expect(c[0] + py.t[0]).toBeCloseTo(2);
    expect(c[2] + py.t[2]).toBeCloseTo(-1);
  });
});
