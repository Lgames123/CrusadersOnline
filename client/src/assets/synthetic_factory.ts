import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS, type BoxDef } from '@crusaders/shared';

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

/** Box-and-capsule mannequin with a visor showing facing direction (-Z). Origin at the feet. */
export function createMannequin(color = 0x9a7b4f): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 12),
    new THREE.MeshLambertMaterial({ color }),
  );
  body.position.y = PLAYER_HEIGHT / 2;
  body.castShadow = true;
  group.add(body);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.12, 0.2),
    new THREE.MeshLambertMaterial({ color: 0x2b2b30 }),
  );
  visor.position.set(0, PLAYER_HEIGHT - 0.3, -PLAYER_RADIUS + 0.02);
  visor.castShadow = true;
  group.add(visor);

  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.6, 0.45),
    new THREE.MeshLambertMaterial({ color: 0x7a2e24 }),
  );
  shield.position.set(-PLAYER_RADIUS - 0.04, 1.05, -0.05);
  shield.castShadow = true;
  group.add(shield);
  return group;
}
