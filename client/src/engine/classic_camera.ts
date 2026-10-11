import * as THREE from 'three';
import { CHARACTER_GROUPS, LEVEL_UNIT_METRES, type MovementWorld } from '@crusaders/shared';

/**
 * The original game's third-person camera, rebuilt from its documented behaviour
 * (docs/reverse-engineering/executable-analysis.md §10). Distances are in the original's
 * feet and converted at the end.
 *
 * - The rig hangs off an anchor 4 ft above the character's feet and turns with the
 *   character's heading and look pitch (the mouse / Numpad 9-7-5).
 * - The eye sits 2.2 ft above and 7 ft behind the anchor in that rotated frame; the view
 *   aims at a point 2.2 ft up and 8 ft ahead, so the camera looks level when the pitch is 0.
 * - When level geometry hides the eye (or the aim point) from a point 2 ft above the
 *   feet, it moves in 1 ft at a time until the line is clear.
 * - Eye and aim point chase their targets each frame at a rate that grows with distance
 *   (lazy when close, quick when far), with an extra pull while the character stands still.
 * - Fixed horizontal field of view of 2·atan(100/120) ≈ 79.6°; near 0.5 ft, far 1600 ft.
 */
const FT = LEVEL_UNIT_METRES;
const ANCHOR_UP = 4;
const RIG_UP = 2.2;
const EYE_BACK = 7;
const AIM_AHEAD = 8;
const SIGHT_ORIGIN_UP = 2;
const EYE_RATE = 0.002;
const AIM_RATE = 0.0008;
export const CLASSIC_HFOV = 2 * Math.atan(100 / 120);
const NEAR = 0.5 * FT;
const FAR = 1600 * FT;

/** Vertical FOV (degrees, for three.js) that keeps the horizontal FOV fixed. */
export function classicVerticalFov(aspect: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(CLASSIC_HFOV / 2) / aspect));
}

export class ClassicCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Collision world for line-of-sight tests; replaced on zone changes. */
  mw: MovementWorld;

  private readonly eye = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private snapped = false;
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly sight = new THREE.Vector3();
  private readonly wantEye = new THREE.Vector3();
  private readonly wantAim = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(mw: MovementWorld, aspect: number) {
    this.mw = mw;
    this.camera = new THREE.PerspectiveCamera(classicVerticalFov(aspect), aspect, NEAR, FAR);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = classicVerticalFov(aspect);
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the target positions on the next update (spawn, zone change). */
  snap(): void {
    this.snapped = false;
  }

  /**
   * @param feet character position (feet, metres)
   * @param yaw heading, radians (0 faces -Z)
   * @param pitch look pitch, radians (negative looks down)
   * @param moving whether the character is moving horizontally
   */
  update(feet: THREE.Vector3, yaw: number, pitch: number, dt: number, moving: boolean): void {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this.fwd.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    this.up.set(-Math.sin(yaw) * -sp, cp, -Math.cos(yaw) * -sp);
    this.anchor.copy(feet);
    this.anchor.y += ANCHOR_UP * FT;
    this.sight.copy(feet);
    this.sight.y += SIGHT_ORIGIN_UP * FT;

    // Targets: back off from the full offsets 1 ft at a time while the view is blocked.
    let back = EYE_BACK;
    do this.rig(this.wantEye, -back);
    while (this.blocked(this.wantEye) && --back > 0);
    let ahead = AIM_AHEAD;
    do this.rig(this.wantAim, ahead);
    while (this.blocked(this.wantAim) && --ahead > 0);

    if (!this.snapped) {
      this.eye.copy(this.wantEye);
      this.aim.copy(this.wantAim);
      this.snapped = true;
    } else {
      const ms = dt * 1000;
      this.chase(this.eye, this.wantEye, ms, EYE_RATE, moving, 2, 5);
      // A smoothed eye that ends up behind a wall jumps to its target instead.
      if (this.blocked(this.eye)) this.eye.copy(this.wantEye);
      this.chase(this.aim, this.wantAim, ms, AIM_RATE, moving, 5, 2);
    }
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.aim);
  }

  /** anchor + rotated (0, RIG_UP, along) feet. */
  private rig(out: THREE.Vector3, along: number): void {
    out.copy(this.anchor).addScaledVector(this.up, RIG_UP * FT).addScaledVector(this.fwd, along * FT);
  }

  /** Moves `cur` towards `want` by a fraction proportional to the gap (in feet). */
  private chase(cur: THREE.Vector3, want: THREE.Vector3, ms: number, rate: number, moving: boolean, near: number, boost: number): void {
    const gap = cur.distanceTo(want) / FT;
    const k = !moving && gap < near ? (near - gap) * boost + 1 : 1;
    const t = Math.min(1, gap * ms * k * rate);
    cur.lerp(want, t);
  }

  private blocked(p: THREE.Vector3): boolean {
    this.tmp.subVectors(p, this.sight);
    const len = this.tmp.length();
    if (len < 1e-4) return false;
    this.tmp.divideScalar(len);
    const r = this.mw.rapier;
    const hit = this.mw.world.castRay(new r.Ray(this.sight, this.tmp), len, true, undefined, CHARACTER_GROUPS);
    return !!hit;
  }
}
