import * as THREE from 'three';

/**
 * Optional fixes for original props whose UVs do not fit their texture (setting fixedPropUvs,
 * not original). Off, the props are drawn exactly as the original data maps them.
 *
 * fchair2.mdl (Fancy Chair, models.ctx 242) is mapped for a texture laid out as a back panel on
 * u 0..0.67 and two frame strips (u 0.66..0.82, 0.84..1). FancyChair.tga, its only texture, is
 * one framed cushion across the whole width (cushion x 0.125..0.875), so the back loses its
 * right-hand frame and the legs and arms show cushion red. The fit stretches the panel islands
 * over the whole picture and moves the strips onto its two frame columns.
 */

/** Frame columns of FancyChair.tga (u), left and right of the cushion. */
const LEFT_FRAME: readonly [number, number] = [0.01, 0.11];
const RIGHT_FRAME: readonly [number, number] = [0.89, 0.99];

/**
 * UVs fitted to FancyChair.tga, from the converted fchair2 UVs (glTF, one vertex per UV corner).
 * Islands are found by shared vertices; each keeps its v and has its u moved.
 */
export function fitFancyChairUvs(uv: ArrayLike<number>, index: ArrayLike<number>): Float32Array {
  const n = uv.length / 2;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = find(index[t]!);
    parent[find(index[t + 1]!)] = a;
    parent[find(index[t + 2]!)] = a;
  }
  const range = new Map<number, [number, number]>();
  for (let i = 0; i < n; i++) {
    const r = range.get(find(i));
    const u = uv[i * 2]!;
    if (!r) range.set(find(i), [u, u]);
    else r[0] = Math.min(r[0], u), r[1] = Math.max(r[1], u);
  }
  const out = Float32Array.from(uv);
  for (let i = 0; i < n; i++) {
    const [lo, hi] = range.get(find(i))!;
    const u = uv[i * 2]!;
    let fitted: number;
    if (hi <= 0.7) {
      // Back panel, seat and its edges: the panel scaled to the whole picture.
      fitted = lo < 0.02 ? (u - lo) / Math.max(hi - lo, 1e-6) : u / 0.67;
    } else {
      const [from, to, [a, b]] = lo < 0.835 ? [0.66, 0.82, LEFT_FRAME] : [0.84, 1, RIGHT_FRAME];
      fitted = a + ((Math.min(Math.max(u, from), to) - from) / (to - from)) * (b - a);
    }
    out[i * 2] = Math.min(1, Math.max(0, fitted));
  }
  return out;
}

/** Registered prop geometries: their original and fitted UVs. */
class PropFixes {
  private on = false;
  private readonly geometries = new Map<THREE.BufferGeometry, { original: THREE.BufferAttribute; fitted: THREE.BufferAttribute }>();

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    for (const [geo, uvs] of this.geometries) geo.setAttribute('uv', on ? uvs.fitted : uvs.original);
  }

  /** Registers a loaded model scene by its converted file (e.g. "models/fchair2.glb"). */
  register(model: string, scene: THREE.Object3D): void {
    if (!/(^|\/)fchair2\.glb$/i.test(model)) return;
    scene.traverse((o) => {
      const geo = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
      const uv = geo?.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (!geo || !uv || !geo.index || this.geometries.has(geo)) return;
      // glTF UVs may be interleaved: read them into a plain array first.
      const plain = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) plain[i * 2] = uv.getX(i), plain[i * 2 + 1] = uv.getY(i);
      const fitted = new THREE.BufferAttribute(fitFancyChairUvs(plain, geo.index.array), 2);
      this.geometries.set(geo, { original: uv, fitted });
      geo.addEventListener('dispose', () => this.geometries.delete(geo));
      if (this.on) geo.setAttribute('uv', fitted);
    });
  }
}

export const propFixes = new PropFixes();
