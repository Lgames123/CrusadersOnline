import * as THREE from 'three';

/**
 * The original's procedural fire image (metatex.ctx `*Fire=Fire`, TYPE=0 PALTYPE=0), which the
 * sword trail wears (material BROWN, BASE=Fire). Reconstructed from its update (0x499010 /
 * 0x499330): a 128-wide grid of "coolness" (0 white-hot .. 255 gone) fed from below by eight
 * random embers (0 / 63 / 126 / 189) whose spot sways about the middle (-16..16 in steps of 8),
 * each cell becoming a weighted mean of itself and the three below plus 2-3 (cooling as it
 * rises), the lower rows narrowed to the middle columns, embers near the source held at 20.
 * Grid rows 64-127 fill the lower half of a 128 x 128 picture through a white - yellow - orange -
 * red - clear ramp (the palette, read in a running game and refitted here as straight segments).
 */
const W = 128;
const ROWS = 138;
const UPDATE_HZ = 30;

/** Palette entry `i` (0 white-hot .. 255 clear) as RGBA bytes. */
function paletteEntry(i: number): [number, number, number, number] {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const a = i <= 128 ? 255 - i / 2 : i <= 192 ? 192 - 2 * (i - 128) : 66 - 2.9 * (i - 192);
  const r = i <= 192 ? a : 66 - 2 * (i - 192);
  const g = i <= 128 ? 257 - 1.5 * i : 65 - (i - 128);
  const b = 259 - 4 * i;
  return [clamp(r), clamp(g), clamp(b), clamp(a)];
}

export class FireTexture {
  readonly texture: THREE.DataTexture;
  private readonly grid = new Uint8Array(W * ROWS).fill(255);
  private readonly pixels = new Uint8Array(W * W * 4);
  private readonly palette: Uint8Array;
  private sway = 0;
  private acc = 0;

  constructor() {
    this.palette = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) this.palette.set(paletteEntry(i), i * 4);
    this.texture = new THREE.DataTexture(this.pixels, W, W, THREE.RGBAFormat);
    this.texture.flipY = false;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 40; i++) this.step();
    this.paint();
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / UPDATE_HZ) return;
    this.acc = Math.min(this.acc - 1 / UPDATE_HZ, 1 / UPDATE_HZ);
    this.step();
    this.paint();
  }

  /** One update of the original: embers then the rise, twice. */
  private step(): void {
    for (let pass = 0; pass < 2; pass++) {
      this.sway += 8;
      if (this.sway > 16) this.sway = -16;
      const from = 0x44bc + this.sway;
      for (let i = from; i < from + 8; i++) this.grid[i] = (Math.floor(Math.random() * 4)) * 63;
      this.rise();
    }
  }

  private rise(): void {
    const g = this.grid;
    for (let i = 0x2000; i < 0x4480; i++) {
      let v: number;
      if (i <= 0x3000) {
        v = (((g[i + 129]! >> 1) + (g[i + 127]! >> 1) + 2 * g[i + 128]! + g[i]!) >> 2) + 3;
      } else {
        // The lower rows only burn in the middle columns (28-100).
        if ((i & 127) > 100) i += 55;
        if (i >= 0x4480) break;
        const x = i & 127;
        if (x > 72) v = ((g[i]! + 2 * ((g[i + 127]! >> 1) + g[i + 128]!)) >> 2) + 3;
        else if (x < 54) v = ((g[i]! + 2 * ((g[i + 129]! >> 1) + g[i + 128]!)) >> 2) + 3;
        else v = (((g[i + 129]! >> 1) + (g[i + 127]! >> 1) + 2 * g[i + 128]! + g[i]!) >> 2) + 2;
        if (i > 0x4200 && v > 5 && v < 75) v = 20;
      }
      g[i] = Math.min(255, v);
    }
  }

  private paint(): void {
    const p = this.pixels;
    const pal = this.palette;
    for (let i = 0; i < 0x2000; i++) {
      const c = this.grid[0x2000 + i]! * 4;
      const o = (0x2000 + i) * 4;
      p[o] = pal[c]!;
      p[o + 1] = pal[c + 1]!;
      p[o + 2] = pal[c + 2]!;
      p[o + 3] = pal[c + 3]!;
    }
    this.texture.needsUpdate = true;
  }
}
