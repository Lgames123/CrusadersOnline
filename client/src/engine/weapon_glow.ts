import * as THREE from 'three';

/**
 * A refined weapon's glow (MMO items, docs/game-design/mmo/04 §4): from +3 the held weapon wears
 * an additive shell of its own meshes, a little larger, coloured and pulsing by tier. The shell
 * has its own materials, so the shared weapon materials are never touched.
 */
const TIERS: readonly { from: number; color: number; strength: number; hz: number }[] = [
  { from: 10, color: 0xffffff, strength: 2.8, hz: 3 },
  { from: 9, color: 0xffd700, strength: 2.0, hz: 2.5 },
  { from: 7, color: 0xd500f9, strength: 1.3, hz: 1.8 },
  { from: 5, color: 0x00e5ff, strength: 0.75, hz: 1 },
  { from: 3, color: 0xcfd8dc, strength: 0.35, hz: 0 },
];

export class WeaponGlow {
  private shell: THREE.Group | null = null;
  private held: THREE.Object3D | null = null;
  private plus = 0;
  private readonly material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide });
  private t = 0;

  /** Each frame: the avatar's model and its weapon's refinement (0 = none). */
  update(model: THREE.Object3D, plus: number, dt: number): void {
    this.t += dt;
    let mount: THREE.Object3D | undefined;
    model.traverse((o) => {
      if (!mount && o.name.endsWith('WPN RIGHT')) mount = o;
    });
    const held = mount?.children.find((c) => c !== this.shell) ?? null;
    const tier = TIERS.find((x) => plus >= x.from);
    if (!tier || !held) return this.clear();
    if (held !== this.held || plus !== this.plus || !this.shell) this.build(held, plus);
    const pulse = tier.hz ? 0.75 + 0.25 * Math.sin(this.t * Math.PI * 2 * tier.hz) : 1;
    this.material.opacity = Math.min(0.85, tier.strength * 0.3) * pulse;
    if (plus >= 10) this.material.color.setHSL((this.t * 0.25) % 1, 0.8, 0.7);
    else this.material.color.setHex(tier.color);
  }

  private build(held: THREE.Object3D, plus: number): void {
    this.clear();
    const shell = new THREE.Group();
    shell.name = 'weapon-glow';
    held.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(held.matrixWorld).invert();
    held.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const copy = new THREE.Mesh(mesh.geometry, this.material);
      // The mesh's place in the held item's frame, then a slightly larger shell around it.
      copy.matrixAutoUpdate = false;
      copy.matrix.multiplyMatrices(inv, mesh.matrixWorld).multiply(new THREE.Matrix4().makeScale(1.06, 1.06, 1.06));
      shell.add(copy);
    });
    held.add(shell);
    this.shell = shell;
    this.held = held;
    this.plus = plus;
  }

  clear(): void {
    this.shell?.removeFromParent();
    this.shell = null;
    this.held = null;
    this.plus = 0;
  }
}
