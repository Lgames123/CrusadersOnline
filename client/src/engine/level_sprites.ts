import * as THREE from 'three';
import type { LevelObject } from '@crusaders/shared';
import { FireTexture } from './fire_texture.ts';

/**
 * The levels' placed sprites (cap class 0x36) as the original draws them (sprite component,
 * runtime class 0x4E11E0: half height +0xC8, half width +0xCC, raise +0xD0, image by name
 * through the metatex at load 0x466DE0; its draw, vtable +0x28 0x466E50, picks one by the raise):
 *
 * - Raised (every TORCHFIRE: 4 / 1.2 / 4 ft), 0x467230: a world quad x -w..w, y raise - h ..
 *   raise + h, turned about the vertical to face the camera (yaw from the camera to the sprite),
 *   so the flames stay upright. TORCHFIRE is metatex `torchfire` = `BASE=Fire`, the one
 *   procedural fire image, shared by every torch (and the sword trails).
 * - Not raised (Flare02-04 12 ft in Bs1a, Flickerslow 1 / 2.5 ft in the Citadel, Cs, Co),
 *   0x466E80: a quad facing the screen, centred, its depth pulled 50 towards the camera (in the
 *   camera's depth units, x 54.6 a foot: about 0.9 ft) so the glow is not cut by what it sits on.
 * Both are white quads over the image, u 0..1 left to right, v 0 at the top.
 */
const GLOW_DEPTH_PULL = 50 / 54.6;

/** A glow sprite: alpha blended (gfx_d3d.dll has no additive blend), its depth pulled `pull` (view units, metres) towards the camera. */
function glowMaterial(map: THREE.Texture, pull: number): THREE.SpriteMaterial {
  const material = new THREE.SpriteMaterial({ map, blending: THREE.NormalBlending, depthWrite: false, transparent: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uDepthPull'] = { value: pull };
    shader.vertexShader = 'uniform float uDepthPull;\n' + shader.vertexShader.replace(
      'gl_Position = projectionMatrix * mvPosition;',
      `gl_Position = projectionMatrix * mvPosition;
      vec4 pulled = projectionMatrix * vec4( mvPosition.xy, min( mvPosition.z + uDepthPull, -0.05 ), 1.0 );
      gl_Position.z = pulled.z / pulled.w * gl_Position.w;`,
    );
  };
  material.customProgramCacheKey = () => 'glow-depth-pull';
  return material;
}

export class LevelSprites {
  /** In original units (added under the placed objects' group). */
  readonly group = new THREE.Group();
  private readonly fire = new FireTexture();
  private readonly fireMat = new THREE.MeshBasicMaterial({ map: this.fire.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private readonly upright: THREE.Mesh[] = [];
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly glowMats = new Map<THREE.Texture, THREE.SpriteMaterial>();
  private readonly cam = new THREE.Vector3();
  private readonly at = new THREE.Vector3();

  /** `unit`: metres per original unit. `map`: the sprite's own image (none for the fire). */
  add(o: LevelObject, unit: number, map: THREE.Texture | null): void {
    const s = o.sprite;
    if (!s) return;
    if (o.effect?.toLowerCase() === 'torchfire') {
      const mesh = new THREE.Mesh(this.quad(s.halfWidth, s.halfHeight, s.raise), this.fireMat);
      mesh.position.set(...o.position);
      this.group.add(mesh);
      this.upright.push(mesh);
      return;
    }
    if (!map) return;
    let material = this.glowMats.get(map);
    if (!material) {
      // Loaded the glTF way (row 0 at v 0); a sprite's v 0 is its bottom, the original's its top.
      const image = map.clone();
      image.flipY = true;
      image.wrapS = image.wrapT = THREE.ClampToEdgeWrapping;
      image.needsUpdate = true;
      this.glowMats.set(map, (material = glowMaterial(image, GLOW_DEPTH_PULL * unit)));
    }
    const sprite = new THREE.Sprite(material);
    sprite.position.set(...o.position);
    sprite.scale.set(2 * s.halfWidth, 2 * s.halfHeight, 1);
    // Anchored at its position: the quad spans raise - h .. raise + h.
    sprite.center.set(0.5, (s.halfHeight - s.raise) / (2 * s.halfHeight));
    this.group.add(sprite);
  }

  /** Every frame: the fire's image and the upright quads turned to the camera. */
  update(camera: THREE.Camera, dt: number): void {
    if (!this.upright.length) return;
    this.fire.update(dt);
    camera.getWorldPosition(this.cam);
    for (const mesh of this.upright) {
      mesh.getWorldPosition(this.at);
      mesh.rotation.y = Math.atan2(this.cam.x - this.at.x, this.cam.z - this.at.z);
    }
  }

  /** The upright quad, facing +Z: v 0 at its top (the fire's image rises from its bottom row). */
  private quad(w: number, h: number, raise: number): THREE.BufferGeometry {
    const key = `${w} ${h} ${raise}`;
    let geo = this.geometries.get(key);
    if (!geo) {
      geo = new THREE.PlaneGeometry(2 * w, 2 * h).translate(0, raise, 0);
      const uv = geo.attributes['uv']!;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      this.geometries.set(key, geo);
    }
    return geo;
  }
}
