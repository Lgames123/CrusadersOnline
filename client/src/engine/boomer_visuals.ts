import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { SpellEventMsg } from '@crusaders/shared';
import type { EffectHandle, Effects } from './effects.ts';
import type { SoundBank } from '../audio/sound_bank.ts';
import type { Avatar } from '../entities/avatar.ts';
import { dynamicLights } from './dynamic_lights.ts';
import { ItemThumbnails } from '../ui/item_thumbnails.ts';
import { nodeFrameInverse } from '../assets/original_models.ts';

/**
 * The Boomer Axe's thrown axe (SpellEventMsg `axe`; executable-analysis §23.1). Its object (type 3,
 * factory 0x0043E850) draws models.ctx 71 (standardaxe.mdl) in the Boomer Axe's texture
 * boomeraxe64, carries MAGIC_AXE_PROJ (effect 0x28, 0x00482150), turns 2160°/s while it flies
 * (0x004C075D) facing its heading, plays the spin loop 334 (0x14E) and lights its surroundings
 * (100, 20, 100) every frame (0x0044BEE0). Its wielder's right hand is empty until it is caught.
 */

const AXE_MODEL = 71;
const AXE_TEXTURE = 1;
const SPIN = (2160 * Math.PI) / 180;
const LIGHT = new THREE.Color(100 / 255, 20 / 255, 100 / 255);
const LOOP_SOUND = 334;
const FOOT = 0.3048;

export interface BoomerVisualHost {
  effects(): Effects | null;
  sounds(): SoundBank | null;
  entity(id: number): { object: THREE.Object3D; avatar: Avatar } | null;
}

interface AxeView {
  owner: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  group: THREE.Group;
  spin: THREE.Group;
  carried: EffectHandle | null;
  stopSound: () => void;
  key: string;
}

export class BoomerVisuals {
  private readonly scene: THREE.Scene;
  private readonly host: BoomerVisualHost;
  private readonly axes = new Map<number, AxeView>();

  constructor(scene: THREE.Scene, host: BoomerVisualHost) {
    this.scene = scene;
    this.host = host;
  }

  handle(a: NonNullable<SpellEventMsg['d']['axe']>): void {
    let v = this.axes.get(a.id);
    if (a.end) {
      if (v) this.remove(a.id, v);
      else this.host.entity(a.owner)?.avatar.showHeld?.('right', true);
      return;
    }
    if (!v) {
      const pos = new THREE.Vector3(...a.pos);
      const group = new THREE.Group();
      const spin = new THREE.Group();
      group.add(spin);
      group.position.copy(pos);
      this.scene.add(group);
      const view: AxeView = {
        owner: a.owner,
        pos,
        vel: new THREE.Vector3(),
        group,
        spin,
        carried: this.host.effects()?.attach('MAGIC_AXE_PROJ', pos, new THREE.Vector3(...a.vel).normalize(), 0) ?? null,
        stopSound: this.loop(pos),
        key: `boomer-axe:${a.id}`,
      };
      v = view;
      this.axes.set(a.id, view);
      this.host.entity(a.owner)?.avatar.showHeld?.('right', false);
      void ItemThumbnails.get().loadModel(AXE_MODEL, AXE_TEXTURE).then((src) => {
        if (!src || this.axes.get(a.id) !== view) return;
        const mesh = cloneSkinned(src);
        const undo = nodeFrameInverse(src);
        if (undo) mesh.applyMatrix4(undo);
        // The model is in feet, standing on its pommel: centred on its box so it turns about its middle.
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.position.sub(box.getCenter(new THREE.Vector3()));
        const holder = new THREE.Group();
        holder.scale.setScalar(FOOT);
        holder.add(mesh);
        view.spin.add(holder);
      });
    }
    v.pos.set(...a.pos);
    v.vel.set(...a.vel);
  }

  /** The spin loop, heard to its Sound.ctx priority's distance from where the throw starts. */
  private loop(at: THREE.Vector3): () => void {
    const sounds = this.host.sounds();
    return sounds ? sounds.play(LOOP_SOUND, at, { loop: true, maxDistance: sounds.reach(LOOP_SOUND) }) : () => {};
  }

  update(dt: number): void {
    for (const v of this.axes.values()) {
      v.pos.addScaledVector(v.vel, dt);
      v.group.position.copy(v.pos);
      if (v.vel.x * v.vel.x + v.vel.z * v.vel.z > 1e-6) v.group.rotation.y = Math.atan2(v.vel.x, v.vel.z);
      v.spin.rotation.x -= SPIN * dt;
      if (v.carried) v.carried.pos.copy(v.pos);
      dynamicLights.set(v.key, v.pos, LIGHT, 1.6, 5, 0);
    }
  }

  clear(): void {
    for (const [id, v] of this.axes) this.remove(id, v);
  }

  private remove(id: number, v: AxeView): void {
    this.scene.remove(v.group);
    v.carried?.stop();
    v.stopSound();
    dynamicLights.remove(v.key);
    this.axes.delete(id);
    this.host.entity(v.owner)?.avatar.showHeld?.('right', true);
  }
}
