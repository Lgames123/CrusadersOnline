import * as THREE from 'three';

/**
 * The light of a converted level at a point: the baked lightmap texel of the floor below it.
 * Characters, props and items take this as their light (the original lights models by the place
 * they stand in; texture x light, like the level itself), and blob shadows sit on that floor.
 * The level's triangles are bucketed in a 2D grid once, so a lookup is cheap.
 */
const CELL = 4;

export class LevelLight {
  private readonly tris: Float32Array; // per triangle: ax ay az bx by bz cx cy cz au av bu bv cu cv
  private readonly grid = new Map<number, number[]>();
  private readonly pixels: Uint8ClampedArray;
  private readonly width: number;
  private readonly height: number;
  private readonly gain: number;

  private constructor(tris: Float32Array, pixels: Uint8ClampedArray, width: number, height: number, gain: number) {
    this.tris = tris;
    this.pixels = pixels;
    this.width = width;
    this.height = height;
    this.gain = gain;
    const n = tris.length / 15;
    for (let i = 0; i < n; i++) {
      const o = i * 15;
      const x0 = Math.min(tris[o]!, tris[o + 3]!, tris[o + 6]!), x1 = Math.max(tris[o]!, tris[o + 3]!, tris[o + 6]!);
      const z0 = Math.min(tris[o + 2]!, tris[o + 5]!, tris[o + 8]!), z1 = Math.max(tris[o + 2]!, tris[o + 5]!, tris[o + 8]!);
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const k = key(cx, cz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(i);
        }
      }
    }
  }

  /** From the level's meshes (world matrices current; sky excluded by the caller) and its lightmap. */
  static build(meshes: THREE.Mesh[], lightMap: THREE.Texture, gain: number): LevelLight | null {
    const image = lightMap.image as CanvasImageSource & { width: number; height: number };
    if (!image?.width) return null;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(image, 0, 0);
    const pixels = g.getImageData(0, 0, image.width, image.height).data;
    const out: number[] = [];
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const uv = geo.getAttribute('uv1') ?? geo.getAttribute('uv2');
      if (!pos || !uv) continue;
      mesh.updateWorldMatrix(true, false);
      const index = geo.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = index ? index.getX(i + k) : i + k;
          v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
          out.push(v.x, v.y, v.z);
        }
        for (let k = 0; k < 3; k++) {
          const vi = index ? index.getX(i + k) : i + k;
          out.push(uv.getX(vi), uv.getY(vi));
        }
      }
    }
    return new LevelLight(new Float32Array(out), pixels, image.width, image.height, gain);
  }

  /**
   * The floor under `pos` (highest level triangle below pos.y + 0.6 m, within 6 m): sets `color`
   * to its light and returns the floor height, or null off the level.
   */
  sample(pos: THREE.Vector3, color: THREE.Color): number | null {
    const list = this.grid.get(key(Math.floor(pos.x / CELL), Math.floor(pos.z / CELL)));
    if (!list) return null;
    const t = this.tris;
    let bestY = -Infinity;
    let bu = 0, bv = 0;
    for (const i of list) {
      const o = i * 15;
      const ax = t[o]!, az = t[o + 2]!, bx = t[o + 3]!, bz = t[o + 5]!, cx = t[o + 6]!, cz = t[o + 8]!;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((bz - cz) * (pos.x - cx) + (cx - bx) * (pos.z - cz)) / d;
      const w1 = ((cz - az) * (pos.x - cx) + (ax - cx) * (pos.z - cz)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const y = w0 * t[o + 1]! + w1 * t[o + 4]! + w2 * t[o + 7]!;
      if (y > pos.y + 0.6 || y < pos.y - 6 || y <= bestY) continue;
      bestY = y;
      bu = w0 * t[o + 9]! + w1 * t[o + 11]! + w2 * t[o + 13]!;
      bv = w0 * t[o + 10]! + w1 * t[o + 12]! + w2 * t[o + 14]!;
    }
    if (bestY === -Infinity) return null;
    this.texel(bu, bv, color);
    return bestY;
  }

  /**
   * Each level triangle in the grid cells within `r` of `pos` (x / z), once: `fn(tris, o)` with
   * the triangle at `tris[o..o + 15]` (corners a b c, then their lightmap uvs).
   */
  forEachNear(pos: THREE.Vector3, r: number, fn: (tris: Float32Array, o: number) => void): void {
    const seen = new Set<number>();
    for (let cx = Math.floor((pos.x - r) / CELL); cx <= Math.floor((pos.x + r) / CELL); cx++) {
      for (let cz = Math.floor((pos.z - r) / CELL); cz <= Math.floor((pos.z + r) / CELL); cz++) {
        for (const i of this.grid.get(key(cx, cz)) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          fn(this.tris, i * 15);
        }
      }
    }
  }

  /** The lightmap at (u, v): sRGB texel to linear, times the level's gain. */
  texel(u: number, v: number, color: THREE.Color): void {
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(u * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(v * this.height)));
    const p = (y * this.width + x) * 4;
    color.setRGB(this.pixels[p]! / 255, this.pixels[p + 1]! / 255, this.pixels[p + 2]! / 255, THREE.SRGBColorSpace).multiplyScalar(this.gain);
  }

  /**
   * Enhanced lighting (not original): the light reaching a model at `feet` from each side, as an
   * ambient cube (+X, -X, +Y, -Y, +Z, -Z: the light on a surface facing that way). +Y is the floor's
   * light, as the classic lighting takes; each other side is the baked light of the nearby level
   * surfaces facing that way (walls lit by a torch light the side of a model facing the same way),
   * found by short rays from chest height. Cached in 1 m cells. False off the level.
   */
  ambientCube(feet: THREE.Vector3, out: THREE.Color[]): boolean {
    const ck = cubeKey(feet);
    let cube = this.cubes.get(ck);
    if (cube === undefined) {
      if (this.cubes.size > CUBE_CACHE_MAX) this.cubes.clear();
      cube = this.buildCube(feet);
      this.cubes.set(ck, cube);
    }
    if (!cube) return false;
    for (let i = 0; i < 6; i++) out[i]!.copy(cube[i]!);
    return true;
  }

  private readonly cubes = new Map<string, THREE.Color[] | null>();

  private buildCube(feet: THREE.Vector3): THREE.Color[] | null {
    const floor = new THREE.Color();
    if (this.sample(feet, floor) === null) return null;
    const chest = new THREE.Vector3(feet.x, feet.y + CHEST, feet.z);
    const cube = AXES.map(() => new THREE.Color());
    const hit = new THREE.Color();
    const sum = new THREE.Color();
    const dir = new THREE.Vector3();
    AXES.forEach((axis, face) => {
      if (face === 2) return void cube[face]!.copy(floor);
      // A surface facing `axis` lies the other way.
      let hits = 0;
      sum.setRGB(0, 0, 0);
      for (const [p, q] of SPREAD) {
        dir.copy(axis).negate().addScaledVector(PERP[face]![0]!, p).addScaledVector(PERP[face]![1]!, q).normalize();
        if (this.raycast(chest, dir, axis, hit)) (sum.add(hit), hits++);
      }
      if (hits) cube[face]!.copy(sum.multiplyScalar(1 / hits));
      // Nothing that way (open sky above, open ground around): the floor's light, less from below.
      else cube[face]!.copy(floor).multiplyScalar(face === 3 ? 0.6 : 1);
      // Only part of the way from the classic single light: a hint of direction, not a re-light.
      cube[face]!.lerp(floor, 1 - DIRECTIONALITY);
    });
    return cube;
  }

  /**
   * The baked light of the nearest level surface along `dir` within RAY_LENGTH, if it faces
   * roughly `facing` (a wall seen edge-on says little about the light on that side).
   */
  private raycast(from: THREE.Vector3, dir: THREE.Vector3, facing: THREE.Vector3, color: THREE.Color): boolean {
    const cells = new Set<number>();
    const steps = Math.ceil((RAY_LENGTH * Math.hypot(dir.x, dir.z)) / (CELL / 2));
    for (let s = 0; s <= steps; s++) {
      const k = (RAY_LENGTH * s) / Math.max(1, steps);
      cells.add(key(Math.floor((from.x + dir.x * k) / CELL), Math.floor((from.z + dir.z * k) / CELL)));
    }
    const t = this.tris;
    let best = RAY_LENGTH;
    let bu = 0, bv = 0, found = false;
    for (const c of cells) {
      for (const i of this.grid.get(c) ?? []) {
        const o = i * 15;
        // Möller-Trumbore.
        const e1x = t[o + 3]! - t[o]!, e1y = t[o + 4]! - t[o + 1]!, e1z = t[o + 5]! - t[o + 2]!;
        const e2x = t[o + 6]! - t[o]!, e2y = t[o + 7]! - t[o + 1]!, e2z = t[o + 8]! - t[o + 2]!;
        const px = dir.y * e2z - dir.z * e2y, py = dir.z * e2x - dir.x * e2z, pz = dir.x * e2y - dir.y * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const sx = from.x - t[o]!, sy = from.y - t[o + 1]!, sz = from.z - t[o + 2]!;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dir.x * qx + dir.y * qy + dir.z * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (d <= 1e-3 || d >= best) continue;
        best = d;
        // Either winding: only how squarely the surface faces that way matters.
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        found = Math.abs(nx * facing.x + ny * facing.y + nz * facing.z) / (Math.hypot(nx, ny, nz) || 1) > 0.4;
        const w0 = 1 - u - v;
        bu = w0 * t[o + 9]! + u * t[o + 11]! + v * t[o + 13]!;
        bv = w0 * t[o + 10]! + u * t[o + 12]! + v * t[o + 14]!;
      }
    }
    if (found) this.texel(bu, bv, color);
    return found;
  }
}

const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

/** Ambient cubes: chest height above the feet, ray reach and cache size (metres, cubes). */
const CHEST = 1;
const RAY_LENGTH = 8;
const CUBE_CACHE_MAX = 8192;
/** How far each side moves from the floor's light towards its own (0: classic, 1: fully its own). */
const DIRECTIONALITY = 0.5;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
/** Two axes across each face's direction, and the spread of its rays over them. */
const PERP = AXES.map((a) => (Math.abs(a.y) > 0.5 ? [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)] : [new THREE.Vector3(0, 1, 0), new THREE.Vector3(-a.z, 0, a.x)]));
const SPREAD: [number, number][] = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]];
const cubeKey = (p: THREE.Vector3) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
