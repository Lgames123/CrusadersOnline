import * as THREE from 'three';
import { ANIM, PLAYER_HEIGHT, PLAYER_RADIUS } from '@crusaders/shared';

/**
 * Visual representation of a character, driven by the replicated animation state. Two
 * implementations: procedural (always available, shipped) and original-model (dev only, from
 * the user's own converted installation; see assets/original_models.ts).
 */
export interface Avatar {
  readonly object: THREE.Object3D;
  /** Height above the feet where name plates / health bars go, metres. */
  readonly headHeight: number;
  /** anim = ANIM.* value; swingSeconds = duration of the current swing when attacking. */
  setState(anim: number, swingSeconds: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** 'player' / 'self', or a mob archetype id (game/combat.ts). */
export type AvatarKind = string;

const COLORS: Record<string, { body: number; trim: number }> = {
  self: { body: 0x9a7b4f, trim: 0x7a2e24 },
  player: { body: 0x4f6f9a, trim: 0x2e4a7a },
  skeleton_warrior: { body: 0xd8d0b8, trim: 0x5a5448 },
  skeleton_ghost: { body: 0xa8c0c8, trim: 0x40505a },
  shadow: { body: 0x3a3a44, trim: 0x18181e },
  dark_mage: { body: 0x4a2a5a, trim: 0x2a1030 },
};

/** Procedural mannequin with a sword whose swing and death pose follow the state. */
export class ProceduralAvatar implements Avatar {
  readonly object = new THREE.Group();
  readonly headHeight = PLAYER_HEIGHT + 0.25;
  private readonly body = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly shield: THREE.Mesh;
  private raise = 0;
  private anim: number = ANIM.IDLE;
  private swingSeconds = 0.5;
  private t = 0;
  private death = 0;

  constructor(kind: AvatarKind) {
    const c = COLORS[kind] ?? COLORS['skeleton_warrior']!;
    const mat = (color: number) => new THREE.MeshLambertMaterial({ color });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 12), mat(c.body));
    torso.position.y = PLAYER_HEIGHT / 2;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.2), mat(kind === 'skeleton_warrior' ? 0x111111 : 0x2b2b30));
    visor.position.set(0, PLAYER_HEIGHT - 0.3, -PLAYER_RADIUS + 0.02);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.45), mat(c.trim));
    shield.position.set(-PLAYER_RADIUS - 0.04, 1.05, -0.05);
    this.shield = shield;
    // Sword arm pivots at the right shoulder.
    this.arm.position.set(PLAYER_RADIUS + 0.05, 1.35, 0);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), mat(0xc8ccd4));
    blade.position.set(0, -0.35, -0.55);
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), mat(0x3a2f1c));
    hilt.position.set(0, -0.35, 0);
    this.arm.add(blade, hilt);
    for (const m of [torso, visor, shield, blade, hilt]) m.castShadow = true;
    this.body.add(torso, visor, shield, this.arm);
    this.object.add(this.body);
  }

  setState(anim: number, swingSeconds: number): void {
    if (anim !== this.anim) {
      this.t = 0;
      if (anim >= ANIM.ATTACK && anim < ANIM.ATTACK + 3) this.swingSeconds = Math.max(0.1, swingSeconds);
    }
    this.anim = anim;
  }

  update(dt: number): void {
    this.t += dt;
    const attacking = this.anim >= ANIM.ATTACK && this.anim < ANIM.ATTACK + 3;
    if (attacking) {
      // Wind up, strike across, recover — direction alternates with the combo index.
      const k = Math.min(1, this.t / this.swingSeconds);
      const dir = (this.anim - ANIM.ATTACK) % 2 === 0 ? 1 : -1;
      const strike = Math.sin(k * Math.PI);
      this.arm.rotation.set(-0.4 - strike * 0.9, dir * (0.9 - k * 1.8), 0);
    } else {
      this.arm.rotation.x += (-0.3 - this.arm.rotation.x) * Math.min(1, dt * 10);
      this.arm.rotation.y += (0 - this.arm.rotation.y) * Math.min(1, dt * 10);
    }
    // Raised shield swings in front of the body.
    const raise = this.anim === ANIM.BLOCK ? 1 : 0;
    this.raise += (raise - this.raise) * Math.min(1, dt * 14);
    this.shield.position.set(-PLAYER_RADIUS - 0.04 + this.raise * 0.3, 1.05 + this.raise * 0.2, -0.05 - this.raise * 0.4);
    this.shield.rotation.y = this.raise * (Math.PI / 2);
    const running = this.anim === ANIM.RUN || this.anim === ANIM.WALK;
    this.body.position.y = running ? Math.abs(Math.sin(this.t * 10)) * 0.08 : 0;
    // Topple over when dead, stand back up on respawn.
    const target = this.anim === ANIM.DEAD ? 1 : 0;
    this.death += (target - this.death) * Math.min(1, dt * 6);
    this.body.rotation.x = this.death * (Math.PI / 2);
    this.body.position.z = this.death * 0.9;
  }

  dispose(): void {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}
