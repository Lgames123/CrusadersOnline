import * as THREE from 'three';
import { ANIM, INPUT, TICK_DT, isLocomotionAnim, SIDE_SWING_CHAIN_SECONDS, SIDE_SWING_RECHAIN_TICKS, gameplayFeatures, type GameplayFeatures, attackAnim, attackMotion, isHitAction, isLayeredSwing, dequantizeAngle, movementAnim, looksGrounded, movementFacingOffset, type AttackKind, attackTiming, COMBO_QUEUE_FRACTION, COMBO_MULTIPLIERS, type Character, type InputFrame, type Vec3, setCharacterState } from '@crusaders/shared';
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
function swingSeconds(kind: AttackKind, combo: number, weaponSpeed: number, clipRate = 1): number {
  const s = attackTiming(kind, combo, weaponSpeed, clipRate);
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
  avatar: Avatar;
  readonly object = new THREE.Group();
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
  /** Seconds of ASM_SPELL_CONJURE left (the feet stay planted, no swings). */
  private castLeft = 0;
  /** Then seconds of the spell's own state left, its ANIM, its ASM state and whether it plays on the upper body. */
  private castClip = 0;
  private castAnim: number = ANIM.IDLE;
  private castUpper = false;
  private castCount = 0;
  private combo = 0;
  /** Root motion of the swing just started, sent with the next input (0 = none). */
  private pendingMotion = 0;
  private kind: AttackKind = 'normal';
  /** The next combo step is queued: it starts when this swing ends. */
  private queued = false;
  /** A queued combo step just started (its sound and wall check are the caller's). */
  onQueuedSwing: (kind: AttackKind) => void = () => {};
  private swingCount = 0;
  private sinceSwing = 99;
  private blocking = false;
  /** Swing duration of the equipped weapon (server INVENTORY_UPDATE weaponSpeed). */
  private swingTime = swingSeconds('normal', 1, 1);
  private weaponSpeed = 1;
  /** The character's clip rate (speed multiplier, SC_PLAYER_STATS speed). */
  clipRate = 1;
  /** The server's gameplay rules (prediction follows them). */
  features: GameplayFeatures = gameplayFeatures();
  dead = false;

  constructor(character: Character, avatar: Avatar, step: (input: Readonly<InputFrame>) => void) {
    this.character = character;
    this.avatar = avatar;
    this.step = step;
    this.prev = { ...character.position };
    this.object.add(avatar.object);
  }

  setAvatar(next: Avatar): void {
    if (this.avatar === next) return;
    const old = this.avatar;
    this.object.remove(old.object);
    next.object.position.set(0, 0, 0);
    next.object.rotation.set(0, 0, 0);
    this.object.add(next.object);
    next.clipRate = this.clipRate;
    next.seed = old.seed;
    next.onEvent = old.onEvent;
    this.avatar = next;
    old.dispose();
  }

  fixedStep(input: Readonly<InputFrame>): void {
    const p = this.character.position;
    this.prev.x = p.x; this.prev.y = p.y; this.prev.z = p.z;
    this.step(input);
    // A hit reaction (impact, stun, knock-down) interrupts the own swing.
    if (isHitAction(this.character.rollDir)) {
      this.swingLeft = 0;
      this.queued = false;
      this.pendingMotion = 0;
      this.castLeft = 0;
      this.castClip = 0;
    }
    const moving = !this.dead && (input.flags & MOVE_MASK) !== 0 && !(input.flags & INPUT.ROOTED);
    // On diagonals the body turns into the direction of travel (as the server replicates it).
    if (moving) this.targetFacing = dequantizeAngle(input.yaw) + movementFacingOffset(input.flags, this.features.diagonalMoves);
    this.blocking = !this.dead && (input.flags & INPUT.BLOCK) !== 0;
    if (this.blocking) this.targetFacing = dequantizeAngle(input.yaw);
    this.moveAnim = this.dead ? ANIM.IDLE : movementAnim(input.flags, looksGrounded(this.character), this.character.rollDir, this.features.diagonalMoves, this.character.airKind);
  }

  setWeaponSpeed(speed: number): void {
    this.weaponSpeed = speed;
  }

  /**
   * Local swing feedback; mirrors the server's combo rule closely enough for presentation.
   * Returns the attack actually started (side swings alternate), 'queued' when the click queued
   * the next combo step (the server queues it too), or null.
   */
  swing(cameraYaw: number, kind: AttackKind = 'normal'): AttackKind | 'queued' | null {
    if (this.dead || this.casting || isHitAction(this.character.rollDir)) return null;
    const side = (k: AttackKind) => k === 'left' || k === 'right';
    if (this.swingLeft > 0) {
      // The combo routine (0x0042CA20): once 10 % of a combo swing has played, a request queues
      // the next step (a tick later than the server's threshold, so the server always agrees).
      const ticks = Math.round(this.swingTime / TICK_DT);
      const queueAt = (Math.ceil(ticks * COMBO_QUEUE_FRACTION) + 1) * TICK_DT;
      if (!this.queued && kind !== 'thrust' && this.kind === 'normal' && this.combo < COMBO_MULTIPLIERS.length && this.swingTime - this.swingLeft >= queueAt) {
        this.queued = true;
        return 'queued';
      }
      // One swing at a time; feature sideSwingRetrigger: a side swing re-triggers 0.3 s in.
      if (!this.features.sideSwingRetrigger || !(side(kind) && side(this.kind) && this.swingTime - this.swingLeft >= SIDE_SWING_RECHAIN_TICKS * TICK_DT)) return null;
    }
    // Feature sideSwingRetrigger: consecutive side swings alternate sides.
    if (this.features.sideSwingRetrigger && side(kind) && side(this.kind) && (this.swingLeft > 0 || this.sinceSwing < SIDE_SWING_CHAIN_SECONDS)) kind = this.kind === 'left' ? 'right' : 'left';
    // A click after a swing has ended starts the combo again; directional attacks are single hits.
    this.begin(kind, 1, cameraYaw);
    return kind;
  }

  private begin(kind: AttackKind, combo: number, cameraYaw: number): void {
    this.combo = combo;
    this.queued = false;
    this.kind = kind;
    this.swingCount++;
    this.swingTime = swingSeconds(kind, this.combo, this.weaponSpeed, this.clipRate);
    this.pendingMotion = attackMotion(kind, this.combo);
    this.swingLeft = this.swingTime;
    if (!isLayeredSwing(kind)) this.targetFacing = cameraYaw;
  }

  /** Latest view heading (mouse / keys), set every rendered frame. */
  set viewHeading(yaw: number) {
    if (!this.dead) this.targetHeading = yaw;
  }

  /** Body heading following the view at the original's turn rate (classic camera yaw). */
  get bodyHeading(): number {
    return this.heading;
  }

  /** A cast in progress (conjure or the spell's state). */
  get casting(): boolean {
    return this.castLeft > 0 || this.castClip > 0;
  }

  /**
   * Starts a cast locally (the server confirms and roots the caster the same way): the conjure
   * (`conjure` seconds, 0 for the spells that skip it), then the spell's state for `clip`
   * seconds - on the upper body when cast on the move (no conjure, moving).
   */
  startCast(plan: { conjure: number; clip: number; anim: number; state: string }): boolean {
    if (this.dead || this.swingLeft > 0 || this.casting || !this.character.grounded || isHitAction(this.character.rollDir)) return false;
    this.castLeft = plan.conjure;
    this.castClip = plan.clip;
    this.castAnim = plan.anim;
    this.castUpper = plan.conjure === 0 && isLocomotionAnim(this.moveAnim);
    this.castCount++;
    if (this.castUpper) this.avatar.setUpperClip?.(plan.state, this.castCount);
    return true;
  }

  /** The root motion of the swing just started (once), for the next input's attack bits. */
  takeAttackMotion(): number {
    const m = this.pendingMotion;
    this.pendingMotion = 0;
    return m;
  }

  /** Own swing playing: the feet stay planted (sent as INPUT.ROOTED). */
  get rooted(): boolean {
    return (this.swingLeft > 0 && !isLayeredSwing(this.kind)) || this.castLeft > 0 || (this.castClip > 0 && !this.castUpper);
  }

  /** A sequence left the stand-in here: the prediction goes on from it (the server moves Drake there too). */
  placeAt(feet: Readonly<Vec3>, yaw: number): void {
    setCharacterState(this.character, feet, 0, false);
    this.prev.x = feet.x; this.prev.y = feet.y; this.prev.z = feet.z;
    this.offset.set(0, 0, 0);
    this.facing = this.targetFacing = this.heading = this.targetHeading = yaw;
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
      // The queued combo step starts as the swing ends.
      if (this.swingLeft <= 0 && this.queued && !this.dead) {
        this.begin('normal', this.combo + 1, this.targetHeading);
        this.onQueuedSwing('normal');
      }
    } else {
      this.sinceSwing += dt;
    }
    if (this.castLeft > 0) this.castLeft -= dt;
    else if (this.castClip > 0) this.castClip -= dt;
    const swinging = this.swingLeft > 0 && !this.dead;
    const layered = swinging && isLayeredSwing(this.kind);
    const anim = this.dead ? ANIM.DEAD
      : this.castLeft > 0 ? ANIM.SPELL_CONJURE
        : this.castClip > 0 && !this.castUpper ? this.castAnim
          : swinging && !layered ? attackAnim(this.kind, this.combo) : this.moveAnim;
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
