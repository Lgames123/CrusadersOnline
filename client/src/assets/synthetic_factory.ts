import * as THREE from 'three';
import type { BoxDef } from '@crusaders/shared';

/** Procedural placeholder assets: the client is fully playable without any original files. */

function gridTexture(base: string, line: string, cells = 4): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = line;
  g.lineWidth = 2;
  const step = size / cells;
  for (let i = 0; i <= cells; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter; // crisp, period-appropriate texels
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PALETTE: Record<BoxDef['kind'], [string, string]> = {
  floor: ['#4a4a46', '#5c5c56'],
  wall: ['#5b4d3c', '#6d5d49'],
  pillar: ['#6b6a64', '#7d7c75'],
  ramp: ['#56604a', '#68735a'],
  platform: ['#56604a', '#68735a'],
};

const textures = new Map<string, THREE.CanvasTexture>();

/** Material for a box, with UVs repeating once per 2 metres. */
export function boxMaterial(kind: BoxDef['kind'], repeatU: number, repeatV: number): THREE.MeshLambertMaterial {
  let base = textures.get(kind);
  if (!base) {
    const [bg, line] = PALETTE[kind];
    base = gridTexture(bg, line);
    textures.set(kind, base);
  }
  const map = base.clone();
  map.repeat.set(repeatU, repeatV);
  map.needsUpdate = true;
  return new THREE.MeshLambertMaterial({ map });
}
