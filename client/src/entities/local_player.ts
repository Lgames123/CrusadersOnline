import * as THREE from 'three';
import { ANIM, INPUT, TICK_DT, dequantizeAngle, swingForWeaponSpeed, type Character, type InputFrame, type Vec3 } from '@crusaders/shared';
import type { Avatar } from './avatar.ts';

const TURN_RATE = 12; // rad/s, visual only
const SMOOTH_RATE = 10; // 1/s decay of visual correction offset
const SNAP_DISTANCE = 2; // corrections larger than this are shown immediately
const MOVE_MASK = INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT;
function swingSeconds(weaponSpeed: number): number {
  const s = swingForWeaponSpeed(weaponSpeed);
  return (s.startup + s.active + s.recovery) * TICK_DT;
}

/**
 * View of the locally predicted character. Physics runs at the fixed tick (offline: local
 * controller; online: ClientSession prediction); rendering interpolates between the previous
 * and current tick and hides small server corrections behind a decaying offset. Swings are
 * shown immediately on click; the server decides whether they hit.
 */
export class LocalPlayer {
  readonly character: Character;
  readonly avatar: Avatar;
  private readonly step: (input: Readonly<InputFrame>) => void;
  private readonly prev: Vec3;
  private readonly offset = new THREE.Vector3();
  private facing = 0;
  private targetFacing = 0;
  private moveAnim: number = ANIM.IDLE;
  private swingLeft = 0;
  private combo = 0;
  private sinceSwing = 99;
  private blocking = false;
  /** Swing duration of the equipped weapon (server INVENTORY_UPDATE weaponSpeed). */
  private swingTime = swingSeconds(1.1);
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
    const moving = !this.dead && (input.flags & MOVE_MASK) !== 0;
    if (moving) this.targetFacing = dequantizeAngle(input.yaw);
    this.blocking = !this.dead && (input.flags & INPUT.BLOCK) !== 0;
    if (this.blocking) this.targetFacing = dequantizeAngle(input.yaw);
    this.moveAnim = !this.character.grounded ? ANIM.AIRBORNE : moving ? (input.flags & INPUT.WALK ? ANIM.WALK : ANIM.RUN) : ANIM.IDLE;
  }

  setWeaponSpeed(speed: number): void {
    this.swingTime = swingSeconds(speed);
  }

  /** Local swing feedback; mirrors the server's combo rule closely enough for presentation. */
  swing(cameraYaw: number): boolean {
    if (this.dead || this.swingLeft > 0) return false;
    this.combo = this.sinceSwing < 0.3 && this.combo < 3 ? this.combo + 1 : 1;
    this.swingLeft = this.swingTime;
    this.targetFacing = cameraYaw;
    return true;
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
    let delta = this.targetFacing - this.facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.facing += delta * Math.min(1, TURN_RATE * dt);
    this.object.rotation.y = this.facing;

    if (this.swingLeft > 0) {
      this.swingLeft -= dt;
      this.sinceSwing = 0;
    } else {
      this.sinceSwing += dt;
    }
    const anim = this.dead ? ANIM.DEAD : this.swingLeft > 0 ? ANIM.ATTACK + this.combo - 1 : this.blocking ? ANIM.BLOCK : this.moveAnim;
    this.avatar.setState(anim, this.swingTime);
    this.avatar.update(dt);
  }
}
