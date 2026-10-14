/**
 * The original's keyframe mover for brushes other than swinging doors: gates, cell doors,
 * levers, platforms, crushers, wheels... (asset-format-discovery.md §6.2.3, decompiled):
 * use 0x48EC10, update 0x48EFC0, advance 0x48F170, end of segment 0x48FFC0, end of path
 * 0x4900C0, segment poses 0x490180 -> 0x48F350 (move) / 0x48F630 (turn about X) / 0x48F960
 * (about Y) / 0x48FC90 (about Z). Server and clients step the same motion.
 *
 * Keys arrive in the placements frame (Z mirrored by the converter, per segment type), where a
 * turn of `angle` about an axis is three.js's rotation by `angle` about that axis.
 */
import type { LevelBrushMotion } from './door_swing.ts';

/** One segment, metres and radians. */
export type MoverSegment =
  | { kind: 'move'; d: [number, number, number] }
  | { kind: 'turn'; axis: 'x' | 'y' | 'z'; angle: number; pivot: [number, number, number] };

export interface MoverDef {
  segments: MoverSegment[];
  /** Progress per millisecond at the ends of each segment and, eased, at its middle. */
  slow: number[];
  fast: number[];
  ease: 'none' | 'inout' | 'in' | 'out';
  /** End-of-path mode (flags & 7, 0x4900C0). */
  mode: number;
  /** Mode 0: go back after the delay (flag 8). */
  returns: boolean;
  delayMs: number;
}

/** Mover states (+0x108). */
export const MOVER_SHUT = 1;
export const MOVER_FORWARD = 2;
export const MOVER_PARKED = 5;
export const MOVER_BACK = 6;
export const MOVER_DONE = 9;

/** A mover's state: +0x108 state, +0x106 key, +0x10C progress, +0x11C delay left (ms). */
export interface MoverMotion {
  state: number;
  key: number;
  progress: number;
  waitMs: number;
  /** Held by a character in its way (sent by the server; clients then hold it too). */
  blocked?: boolean;
}

const MOVE_BITS = 0x07;
const TURN_X = 0x08;
const TURN_Y = 0x10;
const TURN_Z = 0x20;
const RETURNS = 0x8;
const EASED = 0x2000;
const EASE_IN = 0x1000000;
const EASE_OUT = 0x2000000;

/** A brush's mover (swinging doors use door_swing.ts instead); null when it has none. */
export function moverFromMotion(m: LevelBrushMotion, metres: number): MoverDef | null {
  const n = m.keys.length;
  if (!n || m.types.length !== n || m.speeds.length < 2 * n) return null;
  const segments: MoverSegment[] = [];
  for (let i = 0; i < n; i++) {
    const t = m.types[i]!;
    const [a, b, c] = m.keys[i]!;
    const rad = (a * Math.PI) / 180;
    // Dispatch order as 0x490180: move bits first, then X, Y, Z.
    if (t & MOVE_BITS) segments.push({ kind: 'move', d: [a * metres, b * metres, c * metres] });
    else if (t & TURN_X) segments.push({ kind: 'turn', axis: 'x', angle: rad, pivot: [0, b * metres, c * metres] });
    else if (t & TURN_Y) segments.push({ kind: 'turn', axis: 'y', angle: rad, pivot: [b * metres, 0, c * metres] });
    else if (t & TURN_Z) segments.push({ kind: 'turn', axis: 'z', angle: rad, pivot: [b * metres, c * metres, 0] });
    else return null;
  }
  return {
    segments,
    slow: m.speeds.slice(0, n),
    fast: m.speeds.slice(n, 2 * n),
    ease: !(m.flags & EASED) ? 'none' : m.flags & EASE_IN ? 'in' : m.flags & EASE_OUT ? 'out' : 'inout',
    mode: m.flags & 7,
    returns: (m.flags & RETURNS) !== 0,
    delayMs: Math.max(0, m.delayMs),
  };
}

export function shutMover(): MoverMotion {
  return { state: MOVER_SHUT, key: 0, progress: 0, waitMs: 0 };
}

/** The use (0x48EC10): a shut mover sets off forwards, a parked one back. False if it does not move. */
export function useMover(def: MoverDef, m: MoverMotion): boolean {
  if (m.state === MOVER_SHUT) {
    m.state = MOVER_FORWARD;
    m.key = 0;
    return true;
  }
  if (m.state === MOVER_PARKED) {
    m.state = MOVER_BACK;
    m.key = def.segments.length - 1;
    return true;
  }
  return false;
}

/** Progress per ms at `p` of key `k` (0x48EFC0: from the end speed to the middle speed). */
function rate(def: MoverDef, k: number, p: number): number {
  const a = def.slow[k] ?? 0;
  const b = def.fast[k] ?? 0;
  if (def.ease === 'none' || b === 0) return a;
  if (def.ease === 'in') return a + (b - a) * p;
  if (def.ease === 'out') return a + (b - a) * (1 - p);
  return p <= 0.5 ? a + (b - a) * 2 * p : a + (b - a) * (1 - 2 * (p - 0.5));
}

/** End of the path going forwards (0x4900C0): true when the mover stops for this step. */
function endForwards(def: MoverDef, m: MoverMotion): boolean {
  switch (def.mode) {
    case 0:
      if (def.returns) {
        m.state = MOVER_BACK;
        m.waitMs = def.delayMs;
      } else m.state = MOVER_PARKED;
      return true;
    case 1:
    case 3:
      m.state = MOVER_BACK;
      return false;
    case 2:
      m.state = MOVER_PARKED;
      return true;
    case 4:
      Object.assign(m, shutMover());
      return true;
    case 5:
      Object.assign(m, shutMover(), { state: MOVER_FORWARD });
      return false;
    case 6:
      m.state = MOVER_DONE;
      return true;
    default:
      Object.assign(m, shutMover(), { state: MOVER_DONE });
      return true;
  }
}

/** End of a segment (0x48FFC0): true when the mover stops for this step. */
function endSegment(def: MoverDef, m: MoverMotion): boolean {
  const last = def.segments.length - 1;
  if (m.state === MOVER_FORWARD && m.key >= last) return endForwards(def, m);
  if (m.state === MOVER_BACK && m.key <= 0) {
    if (def.mode === 0) m.state = MOVER_SHUT;
    else if (def.mode === 1) {
      m.state = MOVER_FORWARD;
      return false;
    } else if (def.mode === 2 || def.mode === 3) m.state = MOVER_DONE;
    return true;
  }
  if (m.state === MOVER_FORWARD) {
    m.key++;
    m.progress = 0;
  } else {
    m.key--;
    m.progress = 1;
  }
  return false;
}

/** Advances by `ms` (0x48EFC0 / 0x48F170). True while the mover is moving or waiting. */
export function stepMover(def: MoverDef, m: MoverMotion, ms: number): boolean {
  const STEP = 5;
  if (m.blocked) return true;
  while (ms > 0 && (m.state === MOVER_FORWARD || m.state === MOVER_BACK)) {
    const dt = Math.min(STEP, ms);
    ms -= dt;
    if (m.waitMs > 0) {
      m.waitMs = Math.max(0, m.waitMs - dt);
      continue;
    }
    const d = rate(def, m.key, m.progress) * dt;
    if (m.state === MOVER_FORWARD) {
      m.progress += d;
      if (m.progress < 1) continue;
      m.progress = 1;
    } else {
      m.progress -= d;
      if (m.progress > 0) continue;
      m.progress = 0;
    }
    if (endSegment(def, m)) break;
  }
  return m.state === MOVER_FORWARD || m.state === MOVER_BACK;
}

/** A rigid pose: world point = R p + t, R the quaternion (x, y, z, w). */
export interface MoverPose {
  t: [number, number, number];
  q: [number, number, number, number];
}

/** The brush's pose at its motion (0x490210 / 0x490180): earlier moves at full, the current segment at its progress. */
export function moverPose(def: MoverDef, m: MoverMotion): MoverPose {
  const t: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < m.key; i++) {
    const s = def.segments[i]!;
    if (s.kind === 'move') for (let k = 0; k < 3; k++) t[k] = t[k]! + s.d[k]!;
  }
  const s = def.segments[m.key];
  if (!s) return { t, q: [0, 0, 0, 1] };
  const p = m.progress;
  if (s.kind === 'move') {
    for (let k = 0; k < 3; k++) t[k] = t[k]! + s.d[k]! * p;
    return { t, q: [0, 0, 0, 1] };
  }
  // A turn is absolute about its pivot (the turn routines do not take the base): t = c - R c.
  const half = (s.angle * p) / 2;
  const sn = Math.sin(half);
  const q: [number, number, number, number] = [s.axis === 'x' ? sn : 0, s.axis === 'y' ? sn : 0, s.axis === 'z' ? sn : 0, Math.cos(half)];
  const r = rotate(q, s.pivot);
  return { t: [s.pivot[0] - r[0], s.pivot[1] - r[1], s.pivot[2] - r[2]], q };
}

/** Rotates `v` by the unit quaternion `q`. */
export function rotate(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // v' = v + 2w (u x v) + 2 u x (u x v), u = (x, y, z)
  const cx = y * vz - z * vy, cy = z * vx - x * vz, cz = x * vy - y * vx;
  const dx = y * cz - z * cy, dy = z * cx - x * cz, dz = x * cy - y * cx;
  return [vx + 2 * (w * cx + dx), vy + 2 * (w * cy + dy), vz + 2 * (w * cz + dz)];
}
