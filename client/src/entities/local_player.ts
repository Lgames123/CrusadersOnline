import * as THREE from 'three';
import {
  DEFAULT_MOVEMENT_STATS,
  INPUT,
  TICK_DT,
  createCharacter,
  dequantizeAngle,
  stepCharacter,
  type Character,
  type InputFrame,
  type MovementWorld,
  type Vec3,
} from '@crusaders/shared';
import { createMannequin } from '../assets/synthetic_factory.ts';

const TURN_RATE = 12; // rad/s, visual only

/**
 * Locally simulated player. Physics runs at the fixed tick through the shared controller;
 * rendering interpolates between the previous and current tick positions.
 */
export class LocalPlayer {
  readonly character: Character;
  readonly object: THREE.Group;
  private readonly prev: Vec3;
  private facing = 0;
  private targetFacing = 0;

  private readonly mw: MovementWorld;

  constructor(mw: MovementWorld, spawn: Readonly<Vec3>) {
    this.mw = mw;
    this.character = createCharacter(mw, spawn);
    this.prev = { ...this.character.position };
    this.object = createMannequin();
  }

  fixedStep(input: Readonly<InputFrame>): void {
    const p = this.character.position;
    this.prev.x = p.x; this.prev.y = p.y; this.prev.z = p.z;
    stepCharacter(this.mw, this.character, input, DEFAULT_MOVEMENT_STATS, TICK_DT);
    if (input.flags & (INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT)) {
      this.targetFacing = dequantizeAngle(input.yaw);
    }
  }

  /** alpha in [0,1): fraction of the way from the previous to the current tick. */
  render(alpha: number, dt: number): void {
    const p = this.character.position;
    this.object.position.set(
      this.prev.x + (p.x - this.prev.x) * alpha,
      this.prev.y + (p.y - this.prev.y) * alpha,
      this.prev.z + (p.z - this.prev.z) * alpha,
    );
    let delta = this.targetFacing - this.facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.facing += delta * Math.min(1, TURN_RATE * dt);
    this.object.rotation.y = this.facing;
  }
}
