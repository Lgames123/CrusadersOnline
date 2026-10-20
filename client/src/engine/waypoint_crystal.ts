import * as THREE from 'three';

/**
 * A waypoint's teleport crystal (not original; shared/src/game/waypoints.ts): a stone pedestal
 * banded in gold, a floating crown, and between them a blue crystal that turns and bobs among
 * small shards, after the concept art (client/public/waypoint-crystal.webp). Built from
 * primitives: nothing of the original's assets. Its light goes through dynamicLights.
 */
export const CRYSTAL_LIGHT_COLOR = 0x4fb4ff;

const STONE = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.9, metalness: 0.05 });
const GOLD = new THREE.MeshStandardMaterial({ color: 0xb8913f, roughness: 0.45, metalness: 0.8 });
const GLOW = new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const CRYSTAL = new THREE.MeshStandardMaterial({
  color: 0x3d9dff, emissive: 0x2a7fff, emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9, flatShading: true,
});

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(160,220,255,1)');
  r.addColorStop(0.35, 'rgba(80,170,255,0.45)');
  r.addColorStop(1, 'rgba(40,120,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A ring of gold studs (the diamond badges round the art's pedestal and crown). */
function studs(group: THREE.Group, radius: number, y: number, size: number, count: number): void {
  const geo = new THREE.OctahedronGeometry(size, 0);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const m = new THREE.Mesh(geo, GOLD);
    m.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
    m.scale.set(0.6, 1.4, 0.6);
    m.rotation.y = -a;
    group.add(m);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.45, 0), GLOW);
    gem.position.set(Math.cos(a) * (radius + size * 0.35), y, Math.sin(a) * (radius + size * 0.35));
    gem.scale.set(0.6, 1.4, 0.6);
    group.add(gem);
  }
}

export class WaypointCrystal {
  readonly object = new THREE.Group();
  private readonly crystal: THREE.Mesh;
  private readonly crown: THREE.Group;
  private readonly shards: THREE.Mesh[] = [];
  private readonly halo: THREE.Sprite;
  private t = Math.random() * 10;

  constructor() {
    const g = this.object;
    g.name = 'waypoint-crystal';
    // Pedestal: a stepped stone drum, gold bands, a glowing disc on top.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.22, 12), STONE);
    base.position.y = 0.11;
    const step = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 0.22, 12), STONE);
    step.position.y = 0.33;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 12, 1, true), GOLD);
    band.position.y = 0.25;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.04, 6, 24), GOLD);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.45;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), GLOW);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.445;
    g.add(base, step, band, rim, disc);
    studs(g, 0.8, 0.24, 0.1, 4);
    // Crown: the same, upside down, floating over the crystal.
    this.crown = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.68, 0.2, 12), STONE);
    const topBand = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.045, 6, 24), GOLD);
    topBand.rotation.x = Math.PI / 2;
    topBand.position.y = 0.04;
    const under = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.55, 24), GLOW);
    under.rotation.x = Math.PI / 2;
    under.position.y = -0.105;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 8), STONE);
    tip.rotation.x = Math.PI;
    tip.position.y = -0.2;
    this.crown.add(top, topBand, under, tip);
    studs(this.crown, 0.78, 0.02, 0.1, 4);
    this.crown.position.y = 2.55;
    g.add(this.crown);
    // The crystal: a long octahedron.
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), CRYSTAL);
    this.crystal.scale.set(0.85, 1.9, 0.85);
    this.crystal.position.y = 1.45;
    g.add(this.crystal);
    const shardGeo = new THREE.OctahedronGeometry(0.06, 0);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(shardGeo, CRYSTAL);
      s.scale.set(0.7, 1.8, 0.7);
      s.userData['phase'] = (i / 7) * Math.PI * 2;
      s.userData['height'] = 0.9 + ((i * 0.37) % 1) * 1.2;
      s.userData['radius'] = 0.55 + ((i * 0.53) % 1) * 0.25;
      this.shards.push(s);
      g.add(s);
    }
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.set(2.2, 3.2, 1);
    this.halo.position.y = 1.45;
    g.add(this.halo);
    g.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  /** Where its light shines from (world space). */
  lightPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.object.position.x, this.object.position.y + 1.45, this.object.position.z);
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    this.crystal.rotation.y = t * 0.8;
    this.crystal.position.y = 1.45 + Math.sin(t * 1.6) * 0.06;
    this.crown.position.y = 2.55 + Math.sin(t * 1.6 + 0.8) * 0.03;
    this.crown.rotation.y = -t * 0.15;
    for (const s of this.shards) {
      const a = (s.userData['phase'] as number) + t * 0.6;
      const r = s.userData['radius'] as number;
      s.position.set(Math.cos(a) * r, (s.userData['height'] as number) + Math.sin(t * 2 + a) * 0.08, Math.sin(a) * r);
      s.rotation.y = t * 2;
    }
    const pulse = 0.85 + Math.sin(t * 2.2) * 0.15;
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.55 * pulse;
    CRYSTAL.emissiveIntensity = 0.9 + pulse * 0.4;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    (this.halo.material as THREE.SpriteMaterial).map?.dispose();
    this.halo.material.dispose();
  }
}
