import * as THREE from 'three';
import { ENDING_LOAD_SECONDS, LEVEL_UNIT_METRES, NECROS_DEATH, necrosDeathShot, necrosDeathTimeScale } from '@crusaders/shared';

const FT = LEVEL_UNIT_METRES;
/** Ends the view by itself if the ending act never comes (the zone change normally ends it first). */
const GIVE_UP_SECONDS = ENDING_LOAD_SECONDS + 8;

/**
 * Necros's death timeline (0x0044F7B0, ending.ts) on this client: fixed shots of his body, the
 * world in slow motion (`timeScale`, for whoever updates the world's animations), then a fade to
 * white. The server loads the ending act at ENDING_LOAD_SECONDS; the zone change ends this view.
 */
export class NecrosDeath {
  readonly camera: THREE.PerspectiveCamera;
  private t = 0;
  private faded = false;
  private readonly target: THREE.Vector3;
  private readonly fade: (out: boolean, ms: number) => void;

  constructor(base: THREE.PerspectiveCamera, at: { x: number; y: number; z: number }, yaw: number, fade: (out: boolean, ms: number) => void) {
    this.fade = fade;
    this.camera = base.clone();
    // His local (right, up, forward) = (0, 4, 2) ft; forward is -z turned by his heading.
    const [, up, fwd] = NECROS_DEATH.target;
    this.target = new THREE.Vector3(at.x - Math.sin(yaw) * fwd * FT, at.y + up * FT, at.z - Math.cos(yaw) * fwd * FT);
    this.aim();
  }

  /** The world's time scale now (0.1 at the death, 0.5 from 3.5 s). */
  get timeScale(): number {
    return necrosDeathTimeScale(this.t);
  }

  get finished(): boolean {
    return this.t >= GIVE_UP_SECONDS;
  }

  /** `dt`: real seconds (the timeline runs on the real clock, the world slowed under it). */
  update(dt: number): void {
    this.t += dt;
    this.aim();
    if (!this.faded && this.t >= NECROS_DEATH.fadeOut) {
      this.faded = true;
      this.fade(true, NECROS_DEATH.fadeOutSeconds * 1000);
    }
  }

  private aim(): void {
    const s = necrosDeathShot(this.t);
    this.camera.position.set(
      this.target.x + Math.sin(s.angle) * s.distance * FT,
      this.target.y + s.rise * FT,
      this.target.z + Math.cos(s.angle) * s.distance * FT,
    );
    this.camera.lookAt(this.target);
  }
}
