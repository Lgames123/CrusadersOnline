import * as THREE from 'three';
import { INPUT, dequantizeAngle, type Character, type InputFrame, type Vec3 } from '@crusaders/shared';
import { createMannequin } from '../assets/synthetic_factory.ts';

const TURN_RATE = 12; // rad/s, visual only
const SMOOTH_RATE = 10; // 1/s decay of visual correction offset
const SNAP_DISTANCE = 2; // corrections larger than this are shown immediately

/**
 * View of the locally predicted character. Physics runs at the fixed tick (offline: local
 * controller; online: ClientSession prediction); rendering interpolates between the previous
 * and current tick and hides small server corrections behind a decaying offset.
 */
export class LocalPlayer {
  readonly character: Character;
  readonly object: THREE.Group;
  private readonly step: (input: Readonly<InputFrame>) => void;
  private readonly prev: Vec3;
  private readonly offset = new THREE.Vector3();
  private facing = 0;
  private targetFacing = 0;

  constructor(character: Character, step: (input: Readonly<InputFrame>) => void) {
    this.character = character;
    this.step = step;
    this.prev = { ...character.position };
    this.object = createMannequin();
  }

  fixedStep(input: Readonly<InputFrame>): void {
    const p = this.character.position;
    this.prev.x = p.x; this.prev.y = p.y; this.prev.z = p.z;
    this.step(input);
    if (input.flags & (INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT)) {
      this.targetFacing = dequantizeAngle(input.yaw);
    }
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
  }
}
