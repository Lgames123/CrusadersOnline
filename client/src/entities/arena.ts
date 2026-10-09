import * as THREE from 'three';
import type { ArenaDef } from '@crusaders/shared';
import { boxMaterial } from '../assets/synthetic_factory.ts';

/** Renders an ArenaDef. Collision for the same data lives in the shared movement world. */
export function buildArenaMeshes(arena: ArenaDef): THREE.Group {
  const group = new THREE.Group();
  group.name = arena.name;
  for (const b of arena.boxes) {
    const w = b.hx * 2, h = b.hy * 2, d = b.hz * 2;
    const geo = new THREE.BoxGeometry(w, h, d);
    // Repeat the grid every 2 m on the box's largest face.
    const mat = boxMaterial(b.kind, Math.max(w, d) / 2, (b.kind === 'floor' ? Math.min(w, d) : h) / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.rotation.set(b.rotX ?? 0, b.rotY ?? 0, 0, 'YXZ');
    mesh.receiveShadow = true;
    mesh.castShadow = b.kind !== 'floor';
    group.add(mesh);
  }
  return group;
}
