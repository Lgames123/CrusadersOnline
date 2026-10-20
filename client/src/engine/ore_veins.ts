import * as THREE from 'three';
import { ORES, type OreVeinsMsg } from '@crusaders/shared';

/**
 * Ore veins (MMO Stage 6, not original): a grey rock with crystals of the ore's colour; worked
 * out, the crystals go until the vein comes back. Built from primitives.
 */
const ROCK = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.95, flatShading: true });

export class OreVeins {
  private readonly scene: THREE.Scene;
  private readonly veins = new Map<number, { group: THREE.Group; crystals: THREE.Group; kind: keyof typeof ORES; ready: boolean; at: THREE.Vector3 }>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  set(d: OreVeinsMsg['d']): void {
    const seen = new Set<number>();
    for (const v of d.veins) {
      seen.add(v.id);
      let view = this.veins.get(v.id);
      if (!view) {
        const group = new THREE.Group();
        group.position.set(v.at[0], v.at[1], v.at[2]);
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), ROCK);
        rock.scale.set(1.3, 0.7, 1.1);
        rock.position.y = 0.25;
        const crystals = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: ORES[v.kind].color, emissive: ORES[v.kind].color, emissiveIntensity: 0.35, roughness: 0.3, flatShading: true });
        for (let i = 0; i < 5; i++) {
          const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), mat);
          const a = (i / 5) * Math.PI * 2 + v.id;
          c.position.set(Math.cos(a) * 0.35, 0.45 + (i % 2) * 0.12, Math.sin(a) * 0.3);
          c.scale.set(0.8, 1.8, 0.8);
          c.rotation.z = Math.cos(a) * 0.4;
          crystals.add(c);
        }
        group.add(rock, crystals);
        this.scene.add(group);
        view = { group, crystals, kind: v.kind, ready: v.ready, at: new THREE.Vector3(...v.at) };
        this.veins.set(v.id, view);
      }
      view.ready = v.ready;
      view.crystals.visible = v.ready;
    }
    for (const [id, view] of this.veins) {
      if (seen.has(id)) continue;
      view.group.removeFromParent();
      this.veins.delete(id);
    }
  }

  /** The nearest vein within `reach` of a point (any state), or null. */
  nearest(p: THREE.Vector3, reach: number): { id: number; kind: keyof typeof ORES; ready: boolean; d: number } | null {
    let best: { id: number; kind: keyof typeof ORES; ready: boolean; d: number } | null = null;
    for (const [id, v] of this.veins) {
      const d = Math.hypot(v.at.x - p.x, v.at.z - p.z);
      if (d > reach || Math.abs(v.at.y - p.y) > 2.5 || (best && best.d < d)) continue;
      best = { id, kind: v.kind, ready: v.ready, d };
    }
    return best;
  }

  clear(): void {
    this.set({ veins: [] });
  }
}
