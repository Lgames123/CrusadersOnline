import * as THREE from 'three';

/**
 * A boss's attack shown on the floor before it lands (MMO Stage 5, not original;
 * docs/game-design/mmo/06 §3.1): a ring of the attack's radius and a disc filling it as the
 * wind-up runs out. Red: unblockable, get out; yellow: blockable.
 */
export class Telegraphs {
  private readonly scene: THREE.Scene;
  private readonly live: { group: THREE.Group; fill: THREE.Mesh; age: number; life: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  show(at: [number, number, number], radius: number, seconds: number, color: 'red' | 'yellow'): void {
    const hex = color === 'red' ? 0xff3020 : 0xffc020;
    const group = new THREE.Group();
    group.position.set(at[0], at[1] + 0.06, at[2]);
    const ringMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    const fillMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.scale.setScalar(0.01);
    group.add(ring, fill);
    this.scene.add(group);
    this.live.push({ group, fill, age: 0, life: Math.max(0.2, seconds) });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i]!;
      t.age += dt;
      const k = Math.min(1, t.age / t.life);
      t.fill.scale.setScalar(Math.max(0.01, k));
      if (t.age >= t.life + 0.15) {
        t.group.removeFromParent();
        t.group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        this.live.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.update(1e9);
  }
}
