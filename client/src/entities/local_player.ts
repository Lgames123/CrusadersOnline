import * as THREE from 'three';
import { ANIM, INPUT, TICK_DT, SIDE_SWING_CHAIN_SECONDS, attackAnim, attackMotion, isHitAction, isLayeredSwing, dequantizeAngle, movementAnim, movementFacingOffset, type AttackKind, attackTiming, type Character, type InputFrame, type Vec3 } from '@crusaders/shared';
import type { Avatar } from './avatar.ts';

/**
 * The original turns the body towards the view heading at most 270°/s on the ground and 80°/s
 * in the air (executable-analysis §13); the classic camera hangs off the body heading.
 */
const TURN_RATE_GROUND = (270 * Math.PI) / 180;
const TURN_RATE_AIR = (80 * Math.PI) / 180;
const SMOOTH_RATE = 10; // 1/s decay of visual correction offset
const SNAP_DISTANCE = 2; // corrections larger than this are shown immediately
const MOVE_MASK = INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT;
function swingSeconds(kind: AttackKind, combo: number, weaponSpeed: number): number {
  const s = attackTiming(kind, combo, weaponSpeed);
  return (s.startup + s.active + s.recovery) * TICK_DT;
}

/**
 * View of the locally predicted character. Physics runs at the fixed tick (offline: local
 * controller; online: ClientSession prediction); rendering interpolates between the previous
 * and current tick and hides small server corrections behind a decaying offset. Swings are
 * shown immediately on click; the server decides whether they hit.
 */
export class LocalPlayer {
  /** Predicted character; replaced when the player enters another zone. */
  character: Character;
  readonly avatar: Avatar;
  private readonly step: (input: Readonly<InputFrame>) => void;
  private readonly prev: Vec3;
  private readonly offset = new THREE.Vector3();
  private facing = 0;
  private targetFacing = 0;
  /** Rate-limited view heading (no diagonal offset), for the classic camera. */
  private heading = 0;
  private targetHeading = 0;
  private moveAnim: number = ANIM.IDLE;
  private swingLeft = 0;
  private combo = 0;
  /** Root motion of the swing just started, sent with the next input (0 = none). */
  private pendingMotion = 0;
  private kind: AttackKind = 'normal';
  private swingCount = 0;
  private sinceSwing = 99;
  private blocking = false;
  /** Swing duration of the equipped weapon (server INVENTORY_UPDATE weaponSpeed). */
  private swingTime = swingSeconds('normal', 1, 1);
  private weaponSpeed = 1;
  dead = false;

  constructor(character: Character, avatar: Avatar, step: (input: Readonly<InputFrame>) => void) {
    this.character = character;
    this.avatar = avatar;
    this.step = step;
    this.prev = { ...character.position };
  }

  get object(): THREE.Object3D {
    return this.avatar.object;
  }

  fixedStep(input: Readonly<InputFrame>): void {
    const p = this.character.position;
    this.prev.x = p.x; this.prev.y = p.y; this.prev.z = p.z;
    this.step(input);
    // A hit reaction (impact, stun, knock-down) interrupts the own swing.
    if (isHitAction(this.character.rollDir)) {
      this.swingLeft = 0;
      this.pendingMotion = 0;
    }
    const moving = !this.dead && (input.flags & MOVE_MASK) !== 0 && !(input.flags & INPUT.ROOTED);
    // On diagonals the body turns into the direction of travel (as the server replicates it).
    if (moving) this.targetFacing = dequantizeAngle(input.yaw) + movementFacingOffset(input.flags);
    this.blocking = !this.dead && (input.flags & INPUT.BLOCK) !== 0;
    if (this.blocking) this.targetFacing = dequantizeAngle(input.yaw);
    this.moveAnim = this.dead ? ANIM.IDLE : movementAnim(input.flags, this.character.grounded, this.character.rollDir);
  }

  setWeaponSpeed(speed: number): void {
    this.weaponSpeed = speed;
  }

  /**
   * Local swing feedback; mirrors the server's combo rule closely enough for presentation.
   * Returns the attack actually started (side swings alternate), or null.
   */
  swing(cameraYaw: number, kind: AttackKind = 'normal'): AttackKind | null {
    if (this.dead || this.swingLeft > 0 || isHitAction(this.character.rollDir)) return null;
    // Consecutive side swings alternate sides (the first one follows the held key).
    const side = (k: AttackKind) => k === 'left' || k === 'right';
    if (side(kind) && side(this.kind) && this.sinceSwing < SIDE_SWING_CHAIN_SECONDS) kind = this.kind === 'left' ? 'right' : 'left';
    // Directional attacks are single hits; plain clicks chain the combo.
    this.combo = kind === 'normal' && this.kind === 'normal' && this.sinceSwing < 0.3 && this.combo < 5 ? this.combo + 1 : 1;
    this.kind = kind;
    this.swingCount++;
    this.swingTime = swingSeconds(kind, this.combo, this.weaponSpeed);
    this.pendingMotion = attackMotion(kind, this.combo);
    this.swingLeft = this.swingTime;
    if (!isLayeredSwing(kind)) this.targetFacing = cameraYaw;
    return kind;
  }

  /** Latest view heading (mouse / keys), set every rendered frame. */
  set viewHeading(yaw: number) {
    if (!this.dead) this.targetHeading = yaw;
  }

  /** Body heading following the view at the original's turn rate (classic camera yaw). */
  get bodyHeading(): number {
    return this.heading;
  }

  /** The root motion of the swing just started (once), for the next input's attack bits. */
  takeAttackMotion(): number {
    const m = this.pendingMotion;
    this.pendingMotion = 0;
    return m;
  }

  /** Own swing playing: the feet stay planted (sent as INPUT.ROOTED). */
  get rooted(): boolean {
    return this.swingLeft > 0 && !isLayeredSwing(this.kind);
  }

  /** The authoritative state moved the prediction by (dx, dy, dz). */
  correct(dx: number, dy: number, dz: number): void {
    this.prev.x += dx; this.prev.y += dy; this.prev.z += dz;
    if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) this.offset.set(0, 0, 0);
    else this.offset.x -= dx, this.offset.y -= dy, this.offset.z -= dz;
  }

  /** alpha in [0,1): fraction of the way from the previous to the current tick. */
  render(alpha: number, dt: number): void {
    const p = this.character.position;
    this.offset.multiplyScalar(Math.exp(-SMOOTH_RATE * dt));
    this.object.position.set(
      this.prev.x + (p.x - this.prev.x) * alpha + this.offset.x,
      this.prev.y + (p.y - this.prev.y) * alpha + this.offset.y,
      this.prev.z + (p.z - this.prev.z) * alpha + this.offset.z,
    );
    const maxTurn = (this.character.grounded ? TURN_RATE_GROUND : TURN_RATE_AIR) * dt;
    this.facing = turnTowards(this.facing, this.targetFacing, maxTurn);
    this.heading = turnTowards(this.heading, this.targetHeading, maxTurn);
    this.object.rotation.y = this.facing;

    if (this.swingLeft > 0) {
      this.swingLeft -= dt;
      this.sinceSwing = 0;
    } else {
      this.sinceSwing += dt;
    }
    const swinging = this.swingLeft > 0 && !this.dead;
    const layered = swinging && isLayeredSwing(this.kind);
    const anim = this.dead ? ANIM.DEAD : swinging && !layered ? attackAnim(this.kind, this.combo) : this.moveAnim;
    this.avatar.setState(anim, this.swingTime, this.swingCount);
    // Side and air swings play on the upper body over the legs' clip.
    this.avatar.setUpperSwing?.(layered ? this.kind : null, this.swingCount);
    // The rush plays its own clip (PL01), shield included.
    this.avatar.setShield?.(this.blocking && !swinging && this.character.rollDir !== 13);
    this.avatar.update(dt);
  }
}

/** Moves angle `from` towards `to` by at most `maxStep` radians (shortest way round). */
function turnTowards(from: number, to: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-maxStep, Math.min(maxStep, delta));
}
