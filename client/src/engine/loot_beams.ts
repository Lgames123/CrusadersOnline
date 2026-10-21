import * as THREE from 'three';
import { RARITY_INFO, type ItemMods, type Rarity } from '@crusaders/shared';

/**
 * Light shafts over gear lying on the ground, in its rarity's colour (not original: the original
 * has no rarity). Mundane, Tempered and Legendary rise higher and brighter; Battle-worn and
 * items without mods get none, so a plain floor means nothing worth a look. Sizes are in level
 * units (feet), as the level's props.
 */
const BEAM: Readonly<Record<Exclude<Rarity, 'worn'>, { height: number; radius: number; opacity: number }>> = {
  mundane: { height: 5, radius: 0.26, opacity: 0.4 },
  tempered: { height: 8, radius: 0.3, opacity: 0.5 },
  legendary: { height: 13, radius: 0.36, opacity: 0.6 },
};

/** The rank of a rarity for "the best item in a pile" (0: no shaft). */
export function beamRank(mods: ItemMods | undefined): number {
  const r = mods?.rarity;
  return r === 'legendary' ? 3 : r === 'tempered' ? 2 : r === 'mundane' ? 1 : 0;
}

let fade: THREE.CanvasTexture | null = null;
/** Vertical alpha ramp: bright at the floor, gone at the top. */
const fadeTexture = (): THREE.CanvasTexture => {
  if (fade) return fade;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  fade = new THREE.CanvasTexture(c);
  return fade;
};

let ringTex: THREE.CanvasTexture | null = null;
/** A soft ring for the floor under the item. */
const ringTexture = (): THREE.CanvasTexture => {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,.35)');
  grad.addColorStop(0.6, 'rgba(255,255,255,.8)');
  grad.addColorStop(0.75, 'rgba(255,255,255,.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
};

/** Shared materials per rarity, so one pulse drives every shaft of that rarity. */
const materials = new Map<Rarity, { beam: THREE.MeshBasicMaterial; ring: THREE.MeshBasicMaterial; base: number }>();
const materialsFor = (rarity: Exclude<Rarity, 'worn'>) => {
  let m = materials.get(rarity);
  if (!m) {
    const color = new THREE.Color(RARITY_INFO[rarity].color);
    const common = { color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide } as const;
    m = {
      beam: new THREE.MeshBasicMaterial({ ...common, map: fadeTexture(), opacity: BEAM[rarity].opacity }),
      ring: new THREE.MeshBasicMaterial({ ...common, map: ringTexture(), opacity: BEAM[rarity].opacity }),
      base: BEAM[rarity].opacity,
    };
    materials.set(rarity, m);
  }
  return m;
};

/** A shaft and floor ring for gear of this rarity (null: none). Its origin sits on the floor. */
export function lootBeam(mods: ItemMods | undefined): THREE.Object3D | null {
  const rarity = mods?.rarity;
  if (!rarity || rarity === 'worn') return null;
  const { height, radius } = BEAM[rarity];
  const mats = materialsFor(rarity);
  const group = new THREE.Group();
  group.name = 'loot-beam';
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.6, height, 12, 1, true), mats.beam);
  shaft.position.y = height / 2;
  shaft.renderOrder = 5;
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(radius * 7, radius * 7), mats.ring);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.renderOrder = 5;
  for (const m of [shaft, ring]) {
    m.castShadow = m.receiveShadow = false;
    m.raycast = () => {};
  }
  group.add(shaft, ring);
  return group;
}

let clock = 0;
/** Slow breathing of every shaft (call once a frame). */
export function updateLootBeams(dt: number): void {
  clock += dt;
  for (const [rarity, m] of materials) {
    const speed = rarity === 'legendary' ? 3.2 : 2;
    const k = 0.8 + 0.2 * Math.sin(clock * speed);
    m.beam.opacity = m.base * k;
    m.ring.opacity = m.base * (0.7 + 0.3 * Math.sin(clock * speed + 1));
  }
}
