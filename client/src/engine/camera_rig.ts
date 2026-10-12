import * as THREE from 'three';
import type { MovementWorld } from '@crusaders/shared';
import { ChaseCamera } from './camera.ts';
import { ClassicCamera } from './classic_camera.ts';

/**
 * The view camera, blended between the original's camera (zoom 0, the closest) and the
 * modern over-the-shoulder camera (zoom 1, the farthest). The mouse wheel moves between
 * them (player setting); both rigs keep their own collision handling.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly classic: ClassicCamera;
  readonly modern: ChaseCamera;
  /** 0 = classic, 1 = modern. */
  zoom = 0;

  constructor(mw: MovementWorld, aspect: number) {
    this.classic = new ClassicCamera(mw, aspect);
    this.modern = new ChaseCamera(mw, aspect);
    this.camera = this.classic.camera.clone();
  }

  set mw(mw: MovementWorld) {
    this.classic.mw = mw;
    this.modern.mw = mw;
  }

  resize(aspect: number): void {
    this.classic.resize(aspect);
    this.modern.resize(aspect);
    this.camera.aspect = aspect;
    this.blend();
  }

  snap(): void {
    this.classic.snap();
    this.modern.snap();
  }

  /**
   * @param viewYaw the mouse / keyboard heading (modern camera)
   * @param bodyYaw the body heading following it at the original turn rate (classic camera)
   */
  update(target: THREE.Vector3, viewYaw: number, bodyYaw: number, pitch: number, dt: number, moving: boolean): void {
    // Both rigs always run, so their smoothing state is current whenever the zoom changes.
    this.classic.update(target, bodyYaw, pitch, dt, moving);
    this.modern.update(target, viewYaw, pitch, dt, moving);
    this.blend();
  }

  private blend(): void {
    const z = this.zoom;
    const a = this.classic.camera;
    const b = this.modern.camera;
    if (z <= 0) this.copy(a);
    else if (z >= 1) this.copy(b);
    else {
      this.camera.position.lerpVectors(a.position, b.position, z);
      this.camera.quaternion.slerpQuaternions(a.quaternion, b.quaternion, z);
      this.camera.fov = a.fov + (b.fov - a.fov) * z;
      this.camera.near = Math.min(a.near, b.near);
      this.camera.far = Math.max(a.far, b.far);
    }
    this.camera.updateProjectionMatrix();
  }

  private copy(c: THREE.PerspectiveCamera): void {
    this.camera.position.copy(c.position);
    this.camera.quaternion.copy(c.quaternion);
    this.camera.fov = c.fov;
    this.camera.near = c.near;
    this.camera.far = c.far;
  }
}
