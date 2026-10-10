import * as THREE from 'three';
import { CHARACTER_GROUPS, PLAYER_HEIGHT, type MovementWorld } from '@crusaders/shared';

const DISTANCE = 5;
const SHOULDER = 0.6; // over-the-shoulder offset to the right
const PIVOT_HEIGHT = PLAYER_HEIGHT - 0.15;
const CLEARANCE = 0.25;
const SMOOTH = 18;

/** Third-person orbit/chase camera that pulls in when level geometry blocks the view. */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private distance = DISTANCE;
  private readonly pivot = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  private readonly mw: MovementWorld;

  constructor(mw: MovementWorld, aspect: number) {
    this.mw = mw;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 1500);
  }

  update(target: THREE.Vector3, yaw: number, pitch: number, dt: number): void {
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    this.pivot.copy(target).addScaledVector(right, SHOULDER);
    this.pivot.y += PIVOT_HEIGHT;

    // Direction from pivot back to the camera (opposite of view direction).
    const cp = Math.cos(pitch);
    this.dir.set(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp).normalize();

    const r = this.mw.rapier;
    const ray = new r.Ray(this.pivot, this.dir);
    const hit = this.mw.world.castRay(ray, DISTANCE, true, undefined, CHARACTER_GROUPS);
    const wanted = hit ? Math.max(0.3, hit.timeOfImpact - CLEARANCE) : DISTANCE;
    // Pull in instantly (never show inside walls), ease back out.
    this.distance = wanted < this.distance ? wanted : this.distance + (wanted - this.distance) * Math.min(1, SMOOTH * dt * 0.25);

    this.camera.position.copy(this.pivot).addScaledVector(this.dir, this.distance);
    this.camera.lookAt(this.pivot);
  }
}
