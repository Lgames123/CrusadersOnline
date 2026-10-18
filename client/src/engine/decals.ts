import * as THREE from 'three';
import { DECAL_LOOKS, DECAL_RULES, type DecalKind } from '@crusaders/shared';
import type { LevelLight } from './level_light.ts';

/**
 * The original's decals (executable-analysis §8.6c): a weapon's mark where its blade meets a wall
 * (items.ctx `Decal`: CHOP axes, SLAM maces and hammers, SCRATCH swords), a fire ball's scorch,
 * lightning's burn and frost under ice. Stamped like the engine (0x00443580): a square of the
 * kind's size about the point, clipped to each level face that lies in front of the point and
 * close enough, oriented along the blow when there is one, lifted 0.07 ft off the face and lit by
 * the light at the place (here the face's own lightmap). It stays 5 s, fades out over 1.5 s, and
 * a new one ends those it covers.
 */

/** The engine's decal pool (0x00442B05: 50 records); the oldest goes first when it is full. */
const MAX_DECALS = 50;

interface Live {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  at: THREE.Vector3;
  /** Clock time it starts fading. */
  until: number;
}

interface Corner {
  x: number;
  y: number;
  /** Lightmap uv. */
  u: number;
  v: number;
  p: THREE.Vector3;
}

const ab = new THREE.Vector3();
const ac = new THREE.Vector3();
const n = new THREE.Vector3();
const ax = new THREE.Vector3();
const ay = new THREE.Vector3();
const centre = new THREE.Vector3();
const light = new THREE.Color();

export class Decals {
  private readonly scene: THREE.Scene;
  private readonly textureUrl: (name: string) => string | null;
  private readonly textures = new Map<string, THREE.Texture | null>();
  private readonly loader = new THREE.TextureLoader();
  private readonly live: Live[] = [];
  private level: LevelLight | null = null;
  private clock = 0;

  private constructor(scene: THREE.Scene, textureUrl: (name: string) => string | null) {
    this.scene = scene;
    this.textureUrl = textureUrl;
  }

  /** Null without an imported installation. */
  static async load(scene: THREE.Scene): Promise<Decals | null> {
    try {
      const res = await fetch('/generated/manifest.json');
      if (!res.ok) return null;
      const manifest = (await res.json()) as { textures: Record<string, string> };
      return new Decals(scene, (name) => (manifest.textures[name] ? `/generated/${manifest.textures[name]}` : null));
    } catch {
      return null;
    }
  }

  /** The level whose faces take the decals (null: none, e.g. a synthetic arena). Clears the old ones. */
  setLevel(level: LevelLight | null): void {
    this.clear();
    this.level = level;
  }

  /** Stamps a decal about `at` (metres); `dir` turns its length along a blow. */
  stamp(kind: DecalKind, at: THREE.Vector3, dir: THREE.Vector3 | null = null): void {
    const level = this.level;
    const look = DECAL_LOOKS[kind];
    const map = this.texture(look.texture);
    if (!level || !map) return;
    const s = look.size;
    const floorOnly = kind === 'L_FOOTPRINT' || kind === 'R_FOOTPRINT';
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    level.forEachNear(at, s, (t, o) => {
      const a = new THREE.Vector3(t[o], t[o + 1], t[o + 2]);
      const b = new THREE.Vector3(t[o + 3], t[o + 4], t[o + 5]);
      const c = new THREE.Vector3(t[o + 6], t[o + 7], t[o + 8]);
      n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      if (n.lengthSq() < 1e-12) return;
      n.normalize();
      // In front of the face, and near enough that the square reaches it.
      const d = n.dot(ab.subVectors(at, a));
      if (d <= 0 || s * s - d * d < DECAL_RULES.minSpan) return;
      if (floorOnly && n.y < DECAL_RULES.floorY) return;
      centre.copy(at).addScaledVector(n, -d);
      this.axes(dir);
      let poly: Corner[] = [a, b, c].map((p, k) => {
        ab.subVectors(p, centre);
        return { x: ab.dot(ax), y: ab.dot(ay), u: t[o + 9 + k * 2]!, v: t[o + 10 + k * 2]!, p: p.clone() };
      });
      poly = clip(poly, (q) => q.x + s);
      poly = clip(poly, (q) => s - q.x);
      poly = clip(poly, (q) => q.y + s);
      poly = clip(poly, (q) => s - q.y);
      if (poly.length < 3) return;
      const mirror = kind === 'L_FOOTPRINT' ? -1 : 1;
      const put = (q: Corner) => {
        positions.push(q.p.x + n.x * DECAL_RULES.lift, q.p.y + n.y * DECAL_RULES.lift, q.p.z + n.z * DECAL_RULES.lift);
        uvs.push((mirror * q.x / s + 1) / 2, (q.y / s + 1) / 2);
        level.texel(q.u, q.v, light);
        colors.push(light.r, light.g, light.b);
      };
      for (let k = 1; k + 1 < poly.length; k++) (put(poly[0]!), put(poly[k]!), put(poly[k + 1]!));
    });
    if (!positions.length) return;
    // A new decal ends those within twice its size (0x00442E30): they start fading now.
    for (const l of this.live) if (l.at.distanceTo(at) < 2 * s) l.until = Math.min(l.until, this.clock);
    if (this.live.length >= MAX_DECALS) this.remove(0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({
      map,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // Alpha blended like everything the original draws (SRCALPHA / INVSRCALPHA).
      blending: THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.live.push({ mesh, at: at.clone(), until: this.clock + DECAL_RULES.hold });
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i]!;
      const fade = 1 - (this.clock - l.until) / DECAL_RULES.fade;
      if (fade <= 0) this.remove(i);
      else l.mesh.material.opacity = Math.min(1, fade);
    }
  }

  clear(): void {
    while (this.live.length) this.remove(this.live.length - 1);
  }

  private remove(i: number): void {
    const [l] = this.live.splice(i, 1);
    if (!l) return;
    this.scene.remove(l.mesh);
    l.mesh.geometry.dispose();
    l.mesh.material.dispose();
  }

  /** The square's axes on the face (normal `n`): x along the blow, else level for walls. */
  private axes(dir: THREE.Vector3 | null): void {
    if (dir) ax.copy(dir).addScaledVector(n, -dir.dot(n));
    if (!dir || ax.lengthSq() < 1e-6) {
      if (Math.abs(n.y) > 0.999) ax.set(1, 0, 0);
      else ax.set(0, 1, 0).cross(n);
    }
    ax.normalize();
    ay.crossVectors(n, ax);
  }

  private texture(name: string): THREE.Texture | null {
    if (!this.textures.has(name)) {
      const url = this.textureUrl(name);
      const tex = url ? this.loader.load(url) : null;
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(name, tex);
    }
    return this.textures.get(name) ?? null;
  }
}

/** Sutherland–Hodgman: the part of a convex polygon where `side` ≥ 0 (attributes interpolated). */
function clip(poly: Corner[], side: (q: Corner) => number): Corner[] {
  const out: Corner[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const k = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, u: p.u + (q.u - p.u) * k, v: p.v + (q.v - p.v) * k, p: p.p.clone().lerp(q.p, k) });
    }
  }
  return out;
}
