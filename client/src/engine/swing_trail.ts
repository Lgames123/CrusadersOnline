import * as THREE from 'three';
import { FireTexture } from './fire_texture.ts';

/**
 * Weapon swing trails as the original builds them (decompiled: the swing component 0x48C4D0 /
 * 0x48C670 feeds the trail pool 0x4C2F00..0x4C31C0; a trail is a strip of nodes 0x4C8A80 drawn
 * by 0x4C8990 / 0x4C84F0):
 *
 * - Each swing takes a fresh trail (the character's previous one is let go and fades out). Every
 *   frame the weapon's line gives two world points; a new node is added at most every 30 ms
 *   (0.03 s), and in between the newest node just follows the blade.
 * - A node's v is 0.7 + elapsed / (3 x swing length), capped at 1 (0x4C2E00).
 * - Every frame (0x4C30A0) with t = seconds since the swing began, the oldest node's alpha is
 *   100 - 333.3 t and each newer node's 3.333 more, capped at 100 (alpha out of 255).
 * - A released trail goes once t > nodes x 0.01 + 0.3 s (or t > 5 s).
 * - Quads between consecutive nodes: u 0 at the second point, 1 at the first, the node's v;
 *   white vertices over the texture "torchfire" (metatex: BASE=Fire), drawn on both sides.
 */
const MAX_NODES = 64;
const NODE_INTERVAL = 0.03;
const V_START = 0.7;
const ALPHA_MAX = 100;
const ALPHA_FALL = 333.333;
const ALPHA_STEP = 3.3333;
const LINGER_PER_NODE = 0.01;
const LINGER = 0.3;
const MAX_LIFE = 5;

interface Node {
  a: THREE.Vector3;
  b: THREE.Vector3;
  v: number;
}

interface Trail {
  mesh: THREE.Mesh;
  positions: Float32Array;
  uvs: Float32Array;
  alphas: Float32Array;
  nodes: Node[];
  /** Seconds since the swing began. */
  t: number;
  /** Seconds since the last node was added. */
  sinceNode: number;
  /** Swing length (seconds), for v. */
  length: number;
  /** Still fed by its swing. */
  live: boolean;
}

/** One frame of a character's swing: its key (changes per swing) and length (seconds). */
export interface SwingSample {
  key: string;
  seconds: number;
}

export class SwingTrails {
  private readonly scene: THREE.Scene;
  /** Per character: the key of the swing feeding it and its trails (the live one last). */
  private readonly owners = new Map<unknown, { swing: string | null; trails: Trail[] }>();
  private readonly fire = new FireTexture();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Animates the fire the trails wear; once a frame. */
  update(dt: number): void {
    if (this.owners.size) this.fire.update(dt);
  }

  /**
   * Feeds one frame of a character: `sample(a, b)` fills the weapon line's two ends (world) and
   * returns the swing in progress, or null.
   */
  track(key: unknown, sample: (a: THREE.Vector3, b: THREE.Vector3) => SwingSample | null, dt: number): void {
    const swing = sample(this.a, this.b);
    let owner = this.owners.get(key);
    if (!owner) {
      if (!swing) return;
      this.owners.set(key, (owner = { swing: null, trails: [] }));
    }
    for (const t of owner.trails) t.t += dt;
    if (swing && swing.key !== owner.swing) {
      // A new swing: the previous trail is let go, a fresh one starts with its first node.
      for (const t of owner.trails) t.live = false;
      const fresh = this.create(swing.seconds);
      owner.trails.push(fresh);
      this.addNode(fresh, 0);
    } else if (swing) {
      const t = owner.trails.at(-1);
      if (t?.live) this.addNode(t, dt);
    } else for (const t of owner.trails) t.live = false;
    owner.swing = swing?.key ?? null;
    for (let i = owner.trails.length - 1; i >= 0; i--) {
      const t = owner.trails[i]!;
      if ((!t.live && t.t > t.nodes.length * LINGER_PER_NODE + LINGER) || t.t > MAX_LIFE) {
        this.remove(t);
        owner.trails.splice(i, 1);
        continue;
      }
      this.build(t);
    }
    if (!owner.trails.length && !swing) this.owners.delete(key);
  }

  /** Drops the trails of a character that is gone. */
  forget(key: unknown): void {
    const owner = this.owners.get(key);
    if (!owner) return;
    for (const t of owner.trails) this.remove(t);
    this.owners.delete(key);
  }

  /** 0x4C2E00: within 30 ms of the last node the newest one follows the blade; else a new node. */
  private addNode(t: Trail, dt: number): void {
    t.sinceNode += dt;
    if (t.sinceNode < NODE_INTERVAL && t.nodes.length >= 2) {
      const last = t.nodes.at(-1)!;
      last.a.copy(this.a);
      last.b.copy(this.b);
      return;
    }
    t.sinceNode = 0;
    const v = Math.min(1, Math.max(0, V_START + t.t / (t.length * 3)));
    t.nodes.push({ a: this.a.clone(), b: this.b.clone(), v });
    if (t.nodes.length > MAX_NODES) t.nodes.shift();
  }

  private create(length: number): Trail {
    const positions = new Float32Array(MAX_NODES * 2 * 3);
    const uvs = new Float32Array(MAX_NODES * 2 * 2);
    const alphas = new Float32Array(MAX_NODES * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i + 1 < MAX_NODES; i++) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    geo.setIndex(index);
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.fire.texture } },
      vertexShader: 'attribute float alpha; varying float vAlpha; varying vec2 vUv; void main() { vAlpha = alpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying float vAlpha; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb, t.a * vAlpha); }',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { mesh, positions, uvs, alphas, nodes: [], t: 0, sinceNode: 0, length: Math.max(0.1, length), live: true };
  }

  /** 0x4C30A0's alpha ramp (oldest node first) and the strip's vertices. */
  private build(t: Trail): void {
    const n = t.nodes.length;
    let alpha = ALPHA_MAX - ALPHA_FALL * t.t;
    for (let i = 0; i < n; i++) {
      const node = t.nodes[i]!;
      const a = Math.max(0, alpha) / 255;
      alpha = Math.min(ALPHA_MAX, alpha + ALPHA_STEP);
      t.positions.set([node.b.x, node.b.y, node.b.z, node.a.x, node.a.y, node.a.z], i * 6);
      t.uvs.set([0, node.v, 1, node.v], i * 4);
      t.alphas[i * 2] = a;
      t.alphas[i * 2 + 1] = a;
    }
    const geo = t.mesh.geometry;
    geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    geo.attributes['position']!.needsUpdate = true;
    geo.attributes['uv']!.needsUpdate = true;
    geo.attributes['alpha']!.needsUpdate = true;
  }

  private remove(t: Trail): void {
    this.scene.remove(t.mesh);
    t.mesh.geometry.dispose();
    (t.mesh.material as THREE.Material).dispose();
  }
}
