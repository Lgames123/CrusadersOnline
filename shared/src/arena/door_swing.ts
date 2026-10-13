/**
 * Swinging doors: the original's keyframe mover for brushes whose segments turn about the
 * vertical axis (mover update 0x48EFC0, turn 0x48F960; asset-format-discovery.md §6.2.3).
 * A door has one key per opening direction (+90° / -90° about its hinge): the use key opens it
 * away from the player, the eased speed carries it round in ~1.4 s, it stays open for its delay
 * (4 s) and swings back the same way. Server and clients step the same motion.
 */

/** A door's swing, metres and radians (rotation about +Y, the meshes' mirrored frame). */
export interface DoorSwing {
  /** Turn centre (the hinge) and full angle of each key. */
  keys: { cx: number; cz: number; angle: number }[];
  /** Progress per millisecond at the ends of a key's segment and, eased, at its middle. */
  slow: number[];
  fast: number[];
  ease: 'none' | 'inout' | 'in' | 'out';
  /** Milliseconds open before it swings back; null = it stays open. */
  holdMs: number | null;
}

/** A swinging door's state: the key it opened with, progress 0 (shut) .. 1 (open), the phase. */
export interface DoorMotion {
  key: number;
  progress: number;
  phase: 'opening' | 'holding' | 'closing';
  /** Milliseconds of the hold left. */
  holdLeftMs: number;
  /** Waiting for a character to clear its way (sent by the server; clients then hold it). */
  blocked?: boolean;
}

/** Mover flag words (+0x100) and segment types (+0x120) as read from the acts. */
export interface LevelBrushMotion {
  flags: number;
  start: number;
  delayMs: number;
  types: number[];
  /** Per key: degrees, turn centre x, z (placements frame: mirrored like the points). */
  keys: [number, number, number][];
  speeds: number[];
}

const TURN_SEGMENT = 0x10;
const RETURNS = 0x8;
const EASED = 0x2000;
const EASE_IN = 0x1000000;
const EASE_OUT = 0x2000000;

/** The swing of a mover whose segments all turn about the vertical axis; null otherwise. */
export function doorSwingFromMotion(m: LevelBrushMotion, metres: number): DoorSwing | null {
  const n = m.keys.length;
  if (!n || m.types.length !== n || !m.types.every((t) => t & TURN_SEGMENT) || m.speeds.length < 2 * n) return null;
  const slow = m.speeds.slice(0, n);
  const fast = m.speeds.slice(n, 2 * n);
  const ease = !(m.flags & EASED) ? 'none' : m.flags & EASE_IN ? 'in' : m.flags & EASE_OUT ? 'out' : 'inout';
  return {
    keys: m.keys.map(([deg, x, z]) => ({ cx: x * metres, cz: z * metres, angle: (deg * Math.PI) / 180 })),
    slow,
    fast,
    ease,
    holdMs: (m.flags & 7) === 0 && m.flags & RETURNS ? Math.max(0, m.delayMs) : null,
  };
}

/** Progress per ms at `p` of key `k` (mover 0x48EFC0: from the end speed to the middle speed). */
export function swingRate(sw: DoorSwing, k: number, p: number): number {
  const a = sw.slow[k] ?? 0;
  const b = sw.fast[k] ?? 0;
  if (sw.ease === 'none' || b === 0) return a;
  const f = sw.ease === 'in' ? p : sw.ease === 'out' ? 1 - p : 1 - Math.abs(2 * p - 1);
  return a + (b - a) * f;
}

/** Progress after `ms` moving towards `dir` (+1 opening, -1 closing), clamped to 0..1. */
export function advanceSwing(sw: DoorSwing, k: number, p: number, dir: 1 | -1, ms: number): number {
  const STEP = 5;
  while (ms > 0) {
    const dt = Math.min(STEP, ms);
    p += dir * swingRate(sw, k, p) * dt;
    ms -= dt;
    if (p >= 1) return 1;
    if (p <= 0) return 0;
  }
  return p;
}

/** Rotates (x, z) about the key's centre by `angle` (rotation about +Y). */
export function swingPoint(cx: number, cz: number, angle: number, x: number, z: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = x - cx;
  const dz = z - cz;
  return [cx + c * dx + s * dz, cz - s * dx + c * dz];
}

/** The key that opens the door away from (x, z): its open slab's centre ends up farthest. */
export function swingKeyAwayFrom(sw: DoorSwing, points: Float32Array, x: number, z: number): number {
  let mx = 0;
  let mz = 0;
  const n = points.length / 3;
  for (let i = 0; i < n; i++) {
    mx += points[i * 3]! / n;
    mz += points[i * 3 + 2]! / n;
  }
  let best = 0;
  let far = -Infinity;
  sw.keys.forEach((k, i) => {
    const [px, pz] = swingPoint(k.cx, k.cz, k.angle, mx, mz);
    const d = Math.hypot(px - x, pz - z);
    if (d > far) {
      far = d;
      best = i;
    }
  });
  return best;
}

/** Current turn of a door: centre and angle. */
export function swingPose(sw: DoorSwing, m: DoorMotion): { cx: number; cz: number; angle: number } {
  const k = sw.keys[m.key] ?? sw.keys[0]!;
  return { cx: k.cx, cz: k.cz, angle: k.angle * m.progress };
}

/**
 * Steps a door by `ms`: opening, then held open, then closing. Returns false once it is shut
 * (the motion is over). `blocked(progress)` vetoes a move into a character (the door waits).
 */
export function stepDoorMotion(sw: DoorSwing, m: DoorMotion, ms: number, blocked?: (progress: number) => boolean): boolean {
  if (m.blocked) return true;
  if (m.phase === 'holding') {
    if (sw.holdMs === null) return true;
    m.holdLeftMs -= ms;
    if (m.holdLeftMs > 0) return true;
    ms = -m.holdLeftMs;
    m.phase = 'closing';
  }
  const dir = m.phase === 'opening' ? 1 : -1;
  const next = advanceSwing(sw, m.key, m.progress, dir, ms);
  if (blocked?.(next)) return true;
  m.progress = next;
  if (m.phase === 'opening' && next >= 1) {
    m.phase = 'holding';
    m.holdLeftMs = sw.holdMs ?? 0;
  } else if (m.phase === 'closing' && next <= 0) return false;
  return true;
}
