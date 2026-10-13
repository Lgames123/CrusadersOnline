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
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(bu * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(bv * this.height)));
    const p = (y * this.width + x) * 4;
    // sRGB texel to linear, times the level's gain.
    color.setRGB(this.pixels[p]! / 255, this.pixels[p + 1]! / 255, this.pixels[p + 2]! / 255, THREE.SRGBColorSpace).multiplyScalar(this.gain);
    return bestY;
  }
}

const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
