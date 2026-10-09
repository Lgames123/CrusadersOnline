import * as THREE from 'three';
import { INTERP_DELAY_TICKS, type ClientSession, type RemoteSample } from '@crusaders/shared';
import { createMannequin } from '../assets/synthetic_factory.ts';

/** Other players, rendered 100 ms in the past and interpolated between snapshots. */
export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly objects = new Map<number, THREE.Group>();
  private readonly sample: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.objects.size;
  }

  spawn(id: number): void {
    if (this.objects.has(id)) return;
    const obj = createMannequin(0x4f6f9a);
    obj.visible = false; // until the first sample arrives
    this.objects.set(id, obj);
    this.scene.add(obj);
  }

  despawn(id: number): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj);
    this.objects.delete(id);
  }

  update(session: ClientSession): void {
    const renderTick = session.estimateServerTick() - INTERP_DELAY_TICKS;
    for (const [id, obj] of this.objects) {
      if (!session.sampleRemote(id, renderTick, this.sample)) continue;
      obj.visible = true;
      obj.position.set(this.sample.x, this.sample.y, this.sample.z);
      obj.rotation.y = this.sample.yaw;
    }
  }
}
