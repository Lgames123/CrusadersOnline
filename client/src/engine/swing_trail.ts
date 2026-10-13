import * as THREE from 'three';

/**
 * The subtle trail of a sword swing, as the original draws it (logged: the transparent polygon
 * queue at [0x608D00]+0x30 during the plain-click combo, states 23 24 25 103 104; none on the
 * side swings): a ribbon from near the hilt to the blade tip that grows by one segment a frame
 * for the whole swing (up to ~38 quads), its newest edge at alpha 0x64 (39 %) and older ones a
 * little fainter, and once the swing ends it all fades out in ~0.3 s. The original's texture is
 * built at run time ("FINALIMAGE", no file); a warm orange tint stands in for it (playtest
 * screenshot).
 */
const MAX_SAMPLES = 48;
const ALPHA = 100 / 255;
/** Alpha lost by the oldest edge of a full trail (0x64 -> ~0x5C logged). */
const AGE_DIM = 0.08;
const FADE_SECONDS = 0.3;
const COLOR = new THREE.Color(0xd8892f);

interface Trail {
  mesh: THREE.Mesh;
  positions: Float32Array;
  alphas: Float32Array;
  samples: { base: THREE.Vector3; tip: THREE.Vector3 }[];
  /** 1 while swinging, then down to 0 over FADE_SECONDS. */
  fade: number;
  swinging: boolean;
}

export class SwingTrails {
  private readonly trails = new Map<unknown, Trail>();
  private readonly scene: THREE.Scene;
  private readonly base = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Feeds one frame of a character: `sample(base, tip)` fills the blade's ends (world) and
   * returns whether it is in a trailing swing.
   */
  track(key: unknown, sample: (base: THREE.Vector3, tip: THREE.Vector3) => boolean, dt: number): void {
    const swinging = sample(this.base, this.tip);
    let t = this.trails.get(key);
    if (!t) {
      if (!swinging) return;
      t = this.create();
      this.trails.set(key, t);
    }
    if (swinging) {
      if (!t.swinging) t.samples.length = 0; // a new swing starts a new trail
      t.swinging = true;
      t.fade = 1;
      t.samples.push({ base: this.base.clone(), tip: this.tip.clone() });
      if (t.samples.length > MAX_SAMPLES) t.samples.shift();
    } else {
      t.swinging = false;
      t.fade -= dt / FADE_SECONDS;
      if (t.fade <= 0) {
        this.remove(key, t);
        return;
      }
    }
    this.build(t);
  }

  /** Drops the trail of a character that is gone. */
  forget(key: unknown): void {
    const t = this.trails.get(key);
    if (t) this.remove(key, t);
  }

  private create(): Trail {
    const positions = new Float32Array(MAX_SAMPLES * 2 * 3);
    const alphas = new Float32Array(MAX_SAMPLES * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i + 1 < MAX_SAMPLES; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: COLOR } },
      vertexShader: 'attribute float alpha; varying float vAlpha; void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vAlpha; void main() { gl_FragColor = vec4(color, vAlpha); }',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { mesh, positions, alphas, samples: [], fade: 1, swinging: false };
  }

  private build(t: Trail): void {
    const n = t.samples.length;
    for (let i = 0; i < n; i++) {
      const s = t.samples[i]!;
      t.positions.set([s.base.x, s.base.y, s.base.z, s.tip.x, s.tip.y, s.tip.z], i * 6);
      const a = ALPHA * (1 - AGE_DIM * (1 - (i + 1) / n)) * t.fade;
      t.alphas[i * 2] = a;
      t.alphas[i * 2 + 1] = a;
    }
    const geo = t.mesh.geometry;
    geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    geo.attributes['position']!.needsUpdate = true;
    geo.attributes['alpha']!.needsUpdate = true;
  }

  private remove(key: unknown, t: Trail): void {
    this.scene.remove(t.mesh);
    t.mesh.geometry.dispose();
    (t.mesh.material as THREE.Material).dispose();
    this.trails.delete(key);
  }
}
