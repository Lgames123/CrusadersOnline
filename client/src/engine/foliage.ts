import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LEVEL_UNIT_METRES } from '@crusaders/shared';
import type { LevelLight } from './level_light.ts';
import { nodeFrameInverse } from '../assets/original_models.ts';

/**
 * Grass and bushes on a level's grass ground (not original; the "foliage" setting). Built for
 * the level's unlit, lightmapped look and for cost:
 *
 * - Grown on the level's grass ground (deterministic per cell and kind): the earth
 *   (ER) textures, only where the texture under the spot is grass (its green texels), so the
 *   stone and dirt patches painted into them stay bare. Each blade is drawn with that ground
 *   texture at its root times the baked lightmap texel there, as the floor itself is drawn, so
 *   it carries the original grass colours and blends in. No lights, no per-pixel lighting.
 * - Grass is solid geometry (five tapered blades per tuft), not alpha-tested cards: no discard,
 *   so early depth rejection keeps overdraw cheap. Bushes reuse the original bush01 / plant01
 *   models (their own cut-out textures), as the levels place them.
 * - Instanced per CHUNK-metre cell: one draw call per cell and kind, frustum-culled by cell.
 *   Cells are grown only when they come within the render distance (nearest first, a few
 *   milliseconds a frame) and freed when left well behind, so memory follows the area around
 *   the camera and the density settings can go high. A cell's instances are sorted by a random
 *   rank, so drawing the first N is an even thinning: the CPU draws only as many as the density
 *   at the cell's nearest point needs, and the vertex shader shrinks each one away smoothly as
 *   the density at its own distance passes its rank. A density change regrows the cells in reach.
 * - Wind (Perlin noise) only near the player: cells within reach of WIND_RANGE use a shader
 *   variant with the noise, the rest a variant with none; its sway fades to nothing before the
 *   edge, so switching never pops. Grass near the player's feet bends away from them.
 */

/** Cell size, metres. */
const CHUNK = 10;
/** Grass tufts per square metre of grass ground at amount 1. */
const GRASS_DENSITY = 12;
/** The highest density setting (times the base density). */
export const MAX_AMOUNT = 3;
/** Milliseconds a frame spent growing cells (at least one cell a frame when any is due). */
const GROW_BUDGET_MS = 3;

/** Density settings per kind (1 = the base density, 0 = none, up to MAX_AMOUNT). */
export interface FoliageAmounts {
  grass: number;
  bushes: number;
  plants: number;
}
/** Tuft height range, metres. */
const GRASS_HEIGHT: [number, number] = [0.2, 0.4];
/**
 * Render distance (the foliageDistance setting, metres): grass is gone by it; each kind thins
 * out between these fractions of it.
 */
export const FOLIAGE_DISTANCE: { min: number; max: number; default: number } = { min: 15, max: 90, default: 35 };
const GRASS_FADE: [number, number] = [0.55, 1];
/** Wind on everything within WIND_RANGE[0] of the player, fading out by WIND_RANGE[1] (metres). */
const WIND_RANGE: [number, number] = [9, 15];
/** Grass within this distance of the player's feet bends away from them (metres). */
const PUSH_RADIUS = 0.9;
/** Ground steeper than this (normal's y) gets no grass / no bushes. */
const MIN_UP_GRASS = 0.55;
const MIN_UP_BUSH = 0.88;
/** Clearance around placed objects and doors: grass, bushes (metres). */
const CLEAR_GRASS = 0.5;
const CLEAR_BUSH = 2.2;

interface BushKind {
  model: string;
  amount: keyof FoliageAmounts;
  /** Per square metre of grass ground. */
  density: number;
  scale: [number, number];
  /** Fractions of the render distance. */
  fade: [number, number];
  sway: number;
}
const BUSHES: BushKind[] = [
  { model: 'models/bush01.glb', amount: 'bushes', density: 0.024, scale: [0.55, 0.95], fade: [1.3, 1.9], sway: 0.12 },
  { model: 'models/plant01.glb', amount: 'plants', density: 0.07, scale: [0.7, 1.2], fade: [0.85, 1.3], sway: 0.2 },
];
const GRASS_SWAY = 0.35;

/** How much of a texture cell must be grass for a tuft (from 0) and for full density / a bush. */
const GREEN_MIN = 0.25;
const GREEN_FULL = 0.7;
/** Share of a texture's texels that must be grass for it to count as grass ground. */
const GREEN_TEXTURE = 0.3;

/**
 * The ground grass may grow on: the level's meshes (world matrices current; the grass textures
 * among them are picked here), the level's baked light, and the points to keep clear (placed
 * objects, doors).
 */
export interface FoliageGround {
  meshes: THREE.Mesh[];
  light: LevelLight | null;
  avoid: THREE.Vector3[];
  /** Seed: the level's name. */
  seed: string;
}

const PERLIN = `
vec2 fHash( vec2 p ) {
  p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
  return -1.0 + 2.0 * fract( sin( p ) * 43758.5453123 );
}
// Classic 2D gradient (Perlin) noise, about -0.7..0.7.
float perlin( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  return mix(
    mix( dot( fHash( i ), f ), dot( fHash( i + vec2( 1.0, 0.0 ) ), f - vec2( 1.0, 0.0 ) ), u.x ),
    mix( dot( fHash( i + vec2( 0.0, 1.0 ) ), f - vec2( 0.0, 1.0 ) ), dot( fHash( i + vec2( 1.0, 1.0 ) ), f - vec2( 1.0, 1.0 ) ), u.x ),
    u.y );
}
`;

const VERTEX = `
attribute float aBend;
attribute float aShade;
attribute vec4 aOffset; // world x y z, yaw
attribute vec2 aParams; // scale, rank
attribute vec3 aColor;
#ifdef FOLIAGE_GROUND
attribute vec2 aGroundUv;
#endif
uniform vec2 uFade; // fade start, end (metres)
varying vec3 vColor;
#if defined( FOLIAGE_MAP ) || defined( FOLIAGE_GROUND )
varying vec2 vUv;
#endif
#ifdef FOLIAGE_WIND
uniform float uTime;
uniform vec3 uFocus;
uniform vec2 uWindRange;
uniform float uSway;
uniform float uPush;
${PERLIN}
#endif
#include <fog_pars_vertex>
void main() {
  // Thinning with distance: shrinks away as the density here passes this one's rank.
  float density = 1.0 - smoothstep( uFade.x, uFade.y, distance( cameraPosition.xz, aOffset.xz ) );
  float s = aParams.x * clamp( ( density - aParams.y ) * 10.0, 0.0, 1.0 );
  float c = cos( aOffset.w );
  float sn = sin( aOffset.w );
  vec3 p = position * s;
  vec3 world = aOffset.xyz + vec3( c * p.x + sn * p.z, p.y, c * p.z - sn * p.x );
#ifdef FOLIAGE_WIND
  float near = 1.0 - smoothstep( uWindRange.x, uWindRange.y, distance( uFocus.xz, aOffset.xz ) );
  float bend = aBend * aBend * near * s;
  if ( bend > 0.0 ) {
    vec2 q = aOffset.xz * 0.12 + uTime * vec2( 0.31, 0.19 );
    vec2 w = vec2( perlin( q ), perlin( q + vec2( 19.7, 7.3 ) ) );
    float gust = 0.65 + 0.35 * sin( uTime * 1.1 + aOffset.x * 0.05 + aOffset.z * 0.07 );
    world.xz += ( w * 1.6 + vec2( 0.25, 0.12 ) ) * uSway * gust * bend;
#ifdef FOLIAGE_PUSH
    vec2 away = aOffset.xz - uFocus.xz;
    float d = length( away );
    float push = ( 1.0 - smoothstep( 0.15, uPush, d ) ) * step( abs( aOffset.y - uFocus.y ), 1.5 ) * bend;
    world.xz += away / max( d, 1e-3 ) * push * 0.7;
    world.y -= push * 0.4;
#endif
  }
#endif
  vColor = aColor * aShade;
#ifdef FOLIAGE_MAP
  vUv = uv;
#endif
#ifdef FOLIAGE_GROUND
  // The ground texture at the root, a few texels apart along each blade.
  vUv = aGroundUv + position.xz * 0.12;
#endif
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = `
varying vec3 vColor;
#if defined( FOLIAGE_MAP ) || defined( FOLIAGE_GROUND )
uniform sampler2D map;
varying vec2 vUv;
#endif
#include <fog_pars_fragment>
void main() {
  vec4 col = vec4( vColor, 1.0 );
#ifdef FOLIAGE_MAP
  vec4 t = texture2D( map, vUv );
  if ( t.a < 0.5 ) discard;
  col.rgb *= t.rgb;
#endif
#ifdef FOLIAGE_GROUND
  col.rgb *= texture2D( map, vUv ).rgb;
#endif
  gl_FragColor = col;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** A ground texture grass grows on, and where in it there is grass. */
interface Surface {
  map: THREE.Texture;
  mask: NonNullable<ReturnType<typeof grassMask>>;
}

/** A grass-ground triangle (world metres): corners, texture and lightmap coordinates. */
interface GroundTri {
  p: number[];
  uv: number[];
  luv: number[] | null;
  area: number;
  /** Normal's y. */
  up: number;
  surface: Surface;
}

/** A CHUNK-metre cell of grass ground: the triangles in it and their height range. */
interface Cell {
  cx: number;
  cz: number;
  key: string;
  tris: number[];
  minY: number;
  maxY: number;
}

/** One layer grown over one cell (mesh null when nothing grows there). */
interface Chunk {
  mesh: THREE.Mesh | null;
  geo: THREE.InstancedBufferGeometry | null;
  centre: THREE.Vector3;
  radius: number;
  /** Instance ranks, ascending (the order they are stored in). */
  ranks: Float32Array;
  /** The density setting it was grown at. */
  amount: number;
}

/** One kind of foliage (grass on one ground texture, a bush model) and its grown cells. */
interface Layer {
  id: number;
  /** Fractions of the render distance; `uFade` holds them in metres. */
  fade: [number, number];
  uFade: { value: THREE.Vector2 };
  amount: keyof FoliageAmounts;
  /** Grass: the ground texture it grows on; null for bushes (any grass ground flat enough). */
  surface: Surface | null;
  /** Per square metre of grass ground at amount 1. */
  density: number;
  scale: [number, number];
  /** Tallest one, metres. */
  height: number;
  still: THREE.ShaderMaterial;
  wind: THREE.ShaderMaterial;
  chunks: Map<string, Chunk>;
  base: THREE.BufferGeometry;
}

/** One scattered thing: world position, yaw, scale, linear colour, ground texture coordinate. */
interface Instance {
  x: number; y: number; z: number;
  yaw: number; scale: number; rank: number;
  r: number; g: number; b: number;
  u: number; v: number;
}

/** Shared by every layer's materials (one object, so a frame's update reaches them all). */
interface SharedUniforms {
  uTime: { value: number };
  uFocus: { value: THREE.Vector3 };
  uWindRange: { value: THREE.Vector2 };
  uPush: { value: number };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Five tapered blades leaning out from a tuft's centre; unit height, aBend 0 at the root. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const bend: number[] = [];
  const shade: number[] = [];
  const idx: number[] = [];
  const heights = [1, 0.72, 0.88, 0.64, 0.8];
  for (let b = 0; b < heights.length; b++) {
    const a = (b * Math.PI * 2) / heights.length + 0.4;
    const dx = Math.cos(a), dz = Math.sin(a);
    const tx = -dz, tz = dx; // across the blade
    const h = heights[b]!;
    const w = 0.055;
    const o = pos.length / 3;
    const at = (along: number, across: number, y: number, k: number) => {
      pos.push(dx * along + tx * across, y, dz * along + tz * across);
      bend.push(k);
      // The ground's own colour at the root (it grows out of the floor), a little lighter to the tip.
      shade.push(1 + 0.25 * k);
    };
    at(0.03, -w, 0, 0);
    at(0.03, w, 0, 0);
    at(0.08, -w * 0.6, h * 0.55, 0.55);
    at(0.08, w * 0.6, h * 0.55, 0.55);
    at(0.22, 0, h, 1);
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBend', new THREE.Float32BufferAttribute(bend, 1));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  return g;
}

/** An original model's geometry upright in metres, its base on y = 0, aBend by height. */
async function modelGeometry(url: string): Promise<{ geo: THREE.BufferGeometry; map: THREE.Texture | null } | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(`/generated/${url}`);
    let mesh: THREE.Mesh | undefined;
    gltf.scene.traverse((o) => (mesh ??= (o as THREE.Mesh).isMesh ? (o as THREE.Mesh) : undefined));
    if (!mesh) return null;
    gltf.scene.updateMatrixWorld(true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', mesh.geometry.getAttribute('position').clone());
    const uv = mesh.geometry.getAttribute('uv');
    if (uv) geo.setAttribute('uv', uv);
    if (mesh.geometry.index) geo.setIndex(mesh.geometry.index);
    // As placed objects: the model in its own node frame (the baked node transform undone).
    const m = mesh.matrixWorld.clone();
    const undo = nodeFrameInverse(gltf.scene);
    if (undo) m.premultiply(undo);
    geo.applyMatrix4(m);
    geo.scale(LEVEL_UNIT_METRES, LEVEL_UNIT_METRES, LEVEL_UNIT_METRES);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const centre = box.getCenter(new THREE.Vector3());
    geo.translate(-centre.x, -box.min.y, -centre.z);
    const height = Math.max(1e-3, box.max.y - box.min.y);
    const p = geo.getAttribute('position');
    const bend = new Float32Array(p.count);
    const shade = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      bend[i] = p.getY(i) / height;
      shade[i] = 0.8 + 0.25 * bend[i]!;
    }
    geo.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
    geo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
    const map = ((mesh.material as THREE.MeshStandardMaterial).map ?? null);
    return { geo, map };
  } catch {
    return null;
  }
}

/**
 * Where a ground texture is grass: the share of grass texels (green over red, well over blue:
 * the painted stones are grey, the dirt brown) in each cell of a coarse grid, and over the whole
 * texture. Null without readable pixels.
 */
function grassMask(map: THREE.Texture | null): { at(u: number, v: number): number; share: number } | null {
  const img = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width) return null;
  const N = 16;
  try {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const cells = new Float32Array(N * N);
    let total = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const k = (y * img.width + x) * 4;
        const r = d[k]!, gr = d[k + 1]!, bl = d[k + 2]!;
        if (d[k + 3]! < 128 || gr < r * 0.95 || gr < bl * 1.3 || gr < 12) continue;
        const o = Math.floor((y * N) / img.height) * N + Math.floor((x * N) / img.width);
        cells[o] = cells[o]! + 1;
        total++;
      }
    }
    const per = (img.width * img.height) / (N * N);
    for (let i = 0; i < cells.length; i++) cells[i] = cells[i]! / per;
    return {
      share: total / (img.width * img.height),
      // glTF textures are not flipped: v runs down the image.
      at: (u, v) => cells[(Math.floor((v - Math.floor(v)) * N) % N) * N + (Math.floor((u - Math.floor(u)) * N) % N)]!,
    };
  } catch {
    return null;
  }
}

/** Points kept clear, bucketed in 2 m cells. */
class Clearance {
  private readonly cells = new Map<string, THREE.Vector3[]>();
  constructor(points: THREE.Vector3[]) {
    for (const p of points) {
      const k = `${Math.floor(p.x / 2)},${Math.floor(p.z / 2)}`;
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(p);
    }
  }
  clear(x: number, y: number, z: number, r: number): boolean {
    const span = Math.ceil(r / 2);
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        for (const p of this.cells.get(`${cx + i},${cz + j}`) ?? []) {
          if (Math.abs(p.y - y) < 3 && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return false;
        }
      }
    }
    return true;
  }
}

export class Foliage {
  readonly object = new THREE.Group();
  private readonly layers: Layer[] = [];
  private readonly cells: Cell[] = [];
  private readonly tris: GroundTri[] = [];
  private readonly shared: SharedUniforms = {
    uTime: { value: 0 },
    uFocus: { value: new THREE.Vector3(0, -1e6, 0) },
    uWindRange: { value: new THREE.Vector2(...WIND_RANGE) },
    uPush: { value: PUSH_RADIUS },
  };
  private disposed = false;
  private distance = FOLIAGE_DISTANCE.default;
  private amounts: FoliageAmounts = { grass: 1, bushes: 1, plants: 1 };
  private readonly seed: number;
  private readonly clearance: Clearance;
  private readonly light: LevelLight | null;

  private constructor(ground: FoliageGround) {
    this.object.name = 'foliage';
    this.seed = hashString(ground.seed);
    this.clearance = new Clearance(ground.avoid);
    this.light = ground.light;
  }

  /**
   * Finds the grass ground and buckets it into cells; null when the level has none. Nothing is
   * scattered yet: cells fill in as they come within the render distance (update()).
   */
  static async build(ground: FoliageGround): Promise<Foliage | null> {
    const f = new Foliage(ground);
    // Grass ground: earth (ER) textures that are mostly grass, opaque, with texture coordinates.
    const surfaces: Surface[] = [];
    const bySurface = new Map<THREE.Texture, Surface>();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    const cells = new Map<string, Cell>();
    for (const mesh of ground.meshes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (!material.map || material.transparent || material.alphaTest > 0 || !mesh.geometry.getAttribute('uv')) continue;
      if (/^[a-z0-9]+_([a-z]{2})_/.exec(material.name.toLowerCase())?.[1] !== 'er') continue;
      let surface = bySurface.get(material.map);
      if (!surface) {
        const mask = grassMask(material.map);
        if (!mask || mask.share < GREEN_TEXTURE) continue;
        surface = { map: material.map, mask };
        bySurface.set(material.map, surface);
        surfaces.push(surface);
      }
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const uv0 = geo.getAttribute('uv');
      const uv1 = geo.getAttribute('uv1') ?? geo.getAttribute('uv2');
      const index = geo.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const v = [index ? index.getX(i) : i, index ? index.getX(i + 1) : i + 1, index ? index.getX(i + 2) : i + 2] as const;
        a.fromBufferAttribute(pos, v[0]).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, v[1]).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, v[2]).applyMatrix4(mesh.matrixWorld);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const len = n.length();
        if (len <= 0) continue;
        const up = Math.abs(n.y) / len;
        if (up < MIN_UP_GRASS) continue;
        const tri: GroundTri = {
          p: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z],
          uv: v.flatMap((k) => [uv0.getX(k), uv0.getY(k)]),
          luv: uv1 ? v.flatMap((k) => [uv1.getX(k), uv1.getY(k)]) : null,
          area: len / 2,
          up,
          surface,
        };
        const id = f.tris.push(tri) - 1;
        // Into every cell its box touches; points outside a cell are dropped there.
        const x0 = Math.floor(Math.min(a.x, b.x, c.x) / CHUNK), x1 = Math.floor(Math.max(a.x, b.x, c.x) / CHUNK);
        const z0 = Math.floor(Math.min(a.z, b.z, c.z) / CHUNK), z1 = Math.floor(Math.max(a.z, b.z, c.z) / CHUNK);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            const key = `${cx},${cz}`;
            let cell = cells.get(key);
            if (!cell) {
              cell = { cx, cz, key, tris: [], minY: Infinity, maxY: -Infinity };
              cells.set(key, cell);
              f.cells.push(cell);
            }
            cell.tris.push(id);
            cell.minY = Math.min(cell.minY, a.y, b.y, c.y);
            cell.maxY = Math.max(cell.maxY, a.y, b.y, c.y);
          }
        }
      }
    }
    if (!f.tris.length) return null;
    for (const surface of surfaces) f.addLayer(tuftGeometry(), surface.map, 'grass', surface, GRASS_DENSITY, GRASS_FADE, GRASS_SWAY, true, GRASS_HEIGHT[1], [1, 1]);
    const models = await Promise.all(BUSHES.map((k) => modelGeometry(k.model)));
    BUSHES.forEach((kind, k) => {
      const m = models[k];
      if (!m) return;
      m.geo.computeBoundingBox();
      f.addLayer(m.geo, m.map, kind.amount, null, kind.density, kind.fade, kind.sway, false, m.geo.boundingBox!.max.y * kind.scale[1], kind.scale);
    });
    return f;
  }

  /** Render distance, metres (FOLIAGE_DISTANCE): grass is gone by it, bushes a little farther. */
  setDistance(metres: number): void {
    this.distance = Math.min(FOLIAGE_DISTANCE.max, Math.max(FOLIAGE_DISTANCE.min, metres));
    for (const layer of this.layers) layer.uFade.value.set(layer.fade[0] * this.distance, layer.fade[1] * this.distance);
  }

  /** Density per kind (FoliageAmounts): cells already grown regrow at the new density, nearest first. */
  setAmounts(amounts: FoliageAmounts): void {
    this.amounts = { ...amounts };
  }

  private addLayer(base: THREE.BufferGeometry, map: THREE.Texture | null, amount: keyof FoliageAmounts, surface: Surface | null, density: number, fade: [number, number], sway: number, push: boolean, height: number, scale: [number, number]): void {
    const uFade = { value: new THREE.Vector2(fade[0] * this.distance, fade[1] * this.distance) };
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSway: { value: sway } }]);
    // Not merged: merging clones textures, and uFade / the shared ones must stay the same objects.
    Object.assign(uniforms, this.shared, { map: { value: map }, uFade });
    const make = (wind: boolean) => {
      const defines: Record<string, string> = {};
      if (map) defines[surface ? 'FOLIAGE_GROUND' : 'FOLIAGE_MAP'] = '';
      if (wind) defines['FOLIAGE_WIND'] = '';
      if (wind && push) defines['FOLIAGE_PUSH'] = '';
      return new THREE.ShaderMaterial({ uniforms, defines, vertexShader: VERTEX, fragmentShader: FRAGMENT, fog: true, side: THREE.DoubleSide });
    };
    base.computeBoundingSphere();
    this.layers.push({ id: this.layers.length, fade, uFade, amount, surface, density, scale, height, still: make(false), wind: make(true), chunks: new Map(), base });
  }

  /** Scatters one layer over one cell at the current density. */
  private grow(layer: Layer, cell: Cell, amount: number): Chunk {
    const rand = mulberry32(this.seed ^ hashString(`${layer.id}:${cell.key}`));
    const light = new THREE.Color();
    const list: Instance[] = [];
    const density = layer.density * amount;
    const x0 = cell.cx * CHUNK, z0 = cell.cz * CHUNK;
    const grass = layer.surface !== null;
    for (const id of cell.tris) {
      const t = this.tris[id]!;
      if (grass ? t.surface !== layer.surface : t.up < MIN_UP_BUSH) continue;
      const want = t.area * density;
      let k = Math.floor(want) + (rand() < want - Math.floor(want) ? 1 : 0);
      const p = t.p;
      for (; k > 0; k--) {
        // Uniform point in the triangle, kept if it is in this cell.
        let r1 = rand(), r2 = rand();
        if (r1 + r2 > 1) (r1 = 1 - r1, r2 = 1 - r2);
        const w0 = 1 - r1 - r2;
        const x = p[0]! * w0 + p[3]! * r1 + p[6]! * r2;
        const z = p[2]! * w0 + p[5]! * r1 + p[8]! * r2;
        if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
        const y = p[1]! * w0 + p[4]! * r1 + p[7]! * r2;
        if (!this.clearance.clear(x, y, z, grass ? CLEAR_GRASS : CLEAR_BUSH)) continue;
        const u = t.uv[0]! * w0 + t.uv[2]! * r1 + t.uv[4]! * r2;
        const v = t.uv[1]! * w0 + t.uv[3]! * r1 + t.uv[5]! * r2;
        const green = t.surface.mask.at(u, v);
        if (grass) {
          // Only where the texture there is grass: none on its stones and dirt, thinning at their edges.
          const g = (green - GREEN_MIN) / (GREEN_FULL - GREEN_MIN);
          if (g <= 0 || (g < 1 && rand() > g)) continue;
        } else if (green < GREEN_FULL) continue;
        // The baked light there: lightmap x gain (no level light: unlit). Grass is drawn as the
        // floor (MeshBasicMaterial takes a lightmap at 1/pi), bushes as props (without it).
        let k2 = 1;
        if (this.light && t.luv) {
          this.light.texel(t.luv[0]! * w0 + t.luv[2]! * r1 + t.luv[4]! * r2, t.luv[1]! * w0 + t.luv[3]! * r1 + t.luv[5]! * r2, light);
          if (grass) k2 = (1 / Math.PI) * (0.9 + 0.2 * rand());
        } else light.setRGB(1, 1, 1);
        const s = layer.scale[0] + (layer.scale[1] - layer.scale[0]) * rand();
        const scale = grass ? GRASS_HEIGHT[0] + (GRASS_HEIGHT[1] - GRASS_HEIGHT[0]) * rand() : s;
        list.push({ x, y: y - (grass ? 0.02 : 0.05), z, yaw: rand() * Math.PI * 2, scale, rank: rand(), r: light.r * k2, g: light.g * k2, b: light.b * k2, u, v });
      }
    }
    if (!list.length) return { mesh: null, geo: null, centre: new THREE.Vector3(x0 + CHUNK / 2, 0, z0 + CHUNK / 2), radius: CHUNK * 0.71, ranks: new Float32Array(0), amount };

    list.sort((p, q) => p.rank - q.rank);
    const offset = new Float32Array(list.length * 4);
    const params = new Float32Array(list.length * 2);
    const color = new Float32Array(list.length * 3);
    const groundUv = grass ? new Float32Array(list.length * 2) : null;
    const ranks = new Float32Array(list.length);
    list.forEach((p, i) => {
      offset.set([p.x, p.y, p.z, p.yaw], i * 4);
      params.set([p.scale, p.rank], i * 2);
      color.set([p.r, p.g, p.b], i * 3);
      groundUv?.set([p.u, p.v], i * 2);
      ranks[i] = p.rank;
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = layer.base.index;
    for (const [name, attr] of Object.entries(layer.base.attributes)) geo.setAttribute(name, attr);
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 4));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 2));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
    if (groundUv) geo.setAttribute('aGroundUv', new THREE.InstancedBufferAttribute(groundUv, 2));
    geo.instanceCount = list.length;
    // The cell's bounds, grown by the tallest one, its width and its sway.
    const margin = Math.max(layer.base.boundingSphere!.radius * layer.scale[1] * 0.5, 0.3) + 0.5;
    const box = new THREE.Box3(new THREE.Vector3(x0, cell.minY, z0), new THREE.Vector3(x0 + CHUNK, cell.maxY + layer.height, z0 + CHUNK)).expandByScalar(margin);
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geo, layer.still);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = false;
    this.object.add(mesh);
    return { mesh, geo, centre: geo.boundingSphere.center.clone(), radius: geo.boundingSphere.radius, ranks, amount };
  }

  private drop(chunk: Chunk): void {
    chunk.mesh?.removeFromParent();
    chunk.geo?.dispose();
  }

  /**
   * Call every frame: grows the cells coming within reach (nearest first, within a time budget)
   * and frees those left far behind; thinning by distance from the camera; wind near `focus`
   * (the player's feet).
   */
  update(camera: THREE.Camera, focus: THREE.Vector3, dt: number): void {
    if (this.disposed) return;
    this.shared.uTime.value += dt;
    this.shared.uFocus.value.copy(focus);
    const cam = camera.position;
    const wanted: { layer: Layer; cell: Cell; d: number }[] = [];
    for (const layer of this.layers) {
      const { x: f0, y: f1 } = layer.uFade.value;
      const amount = Math.min(MAX_AMOUNT, Math.max(0, this.amounts[layer.amount]));
      for (const cell of this.cells) {
        const d = Math.max(0, Math.hypot((cell.cx + 0.5) * CHUNK - cam.x, (cell.cz + 0.5) * CHUNK - cam.z) - CHUNK * 0.71);
        let ch = layer.chunks.get(cell.key);
        if (d >= f1) {
          // Out of reach: hidden, freed once well behind.
          if (ch?.mesh) ch.mesh.visible = false;
          if (ch && d > f1 + CHUNK * 2) (this.drop(ch), layer.chunks.delete(cell.key));
          continue;
        }
        if (!ch || ch.amount !== amount) wanted.push({ layer, cell, d });
        if (!ch?.mesh || !ch.geo) continue;
        // Draw only the instances the density at the cell's nearest point keeps (ranks below it).
        const t = Math.min(1, Math.max(0, (d - f0) / (f1 - f0)));
        const density = 1 - t * t * (3 - 2 * t);
        let lo = 0, hi = ch.ranks.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ch.ranks[mid]! < density) lo = mid + 1;
          else hi = mid;
        }
        ch.geo.instanceCount = lo;
        ch.mesh.visible = lo > 0;
        const dFocus = Math.hypot(ch.centre.x - focus.x, ch.centre.z - focus.z) - ch.radius;
        ch.mesh.material = dFocus < WIND_RANGE[1] ? layer.wind : layer.still;
      }
    }
    if (!wanted.length) return;
    // Nearest first; at least one a frame, then as many as fit the budget.
    wanted.sort((p, q) => p.d - q.d);
    const start = performance.now();
    for (const w of wanted) {
      const amount = Math.min(MAX_AMOUNT, Math.max(0, this.amounts[w.layer.amount]));
      const old = w.layer.chunks.get(w.cell.key);
      const ch = this.grow(w.layer, w.cell, amount);
      if (old) this.drop(old);
      if (ch.mesh) ch.mesh.visible = false; // shown by next frame's pass, with its count
      w.layer.chunks.set(w.cell.key, ch);
      if (performance.now() - start > GROW_BUDGET_MS) break;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.object.removeFromParent();
    for (const layer of this.layers) {
      for (const ch of layer.chunks.values()) this.drop(ch);
      layer.chunks.clear();
      layer.base.dispose();
      layer.still.dispose();
      layer.wind.dispose();
    }
    this.layers.length = 0;
  }
}
