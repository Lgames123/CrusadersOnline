import * as THREE from 'three';
import {
  ANIM,
  INTERP_DELAY_TICKS,
  MOB_ARCHETYPES,
  TICK_DT,
  UPPER_SWING_CODES,
  MOB_UPPER_SWING_CODES,
  type ClientSession,
  type EntityInfo,
  type RemoteSample,
} from '@crusaders/shared';
import { ProceduralAvatar, type Avatar, type AvatarKind } from './avatar.ts';
import type { AvatarFactory, HeldOverride } from '../assets/original_models.ts';
import { TORCH_LIGHT_COLOR, TORCH_LIGHT_HEIGHT, TORCH_LIGHT_INTENSITY, TORCH_DYNAMIC_INTENSITY, torchRadius } from './torch_light.ts';
import { dynamicLights } from '../engine/dynamic_lights.ts';

export interface RemoteEntity {
  id: number;
  info: EntityInfo;
  avatar: Avatar;
  visible: boolean;
  hp: number;
  /** Swing counter: bumps whenever the replicated swing phase starts over. */
  swingId: number;
  lastPhase: number;
  /**
   * Killed by a combat event not yet in the (100 ms late) snapshots: it dies at once, dropping
   * whatever it was doing, until the snapshots show it dead too.
   */
  killed?: boolean;
}

/** Other players and mobs, rendered 100 ms in the past and interpolated between snapshots. */
export class RemoteEntities {
  readonly byId = new Map<number, RemoteEntity>();
  private readonly scene: THREE.Scene;
  private readonly originals: AvatarFactory | null;
  private readonly sample: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, animPhase: 0, hp: 0, flags: 0 };

  /** Original levels: what a placement holds and gestures with while talking (by placement index). */
  placementLook: (placement: number) => { held?: HeldOverride; talkState?: string; scale?: number } | undefined = () => undefined;

  /** Entities a scripted sequence is playing on this client: not moved by snapshots meanwhile. */
  readonly scripted = new Set<number>();

  /** Animation rates set by spell effects (slowed 0.3, frozen 0), by entity. */
  readonly rates = new Map<number, number>();

  /** Entities fading out before they go (seconds left, of `total`). */
  private readonly fades = new Map<number, { left: number; total: number }>();

  /** Torch lights carried by other players (Torch Light spell). */
  private readonly lights = new Map<number, THREE.PointLight>();

  constructor(scene: THREE.Scene, originals: AvatarFactory | null) {
    this.scene = scene;
    this.originals = originals;
  }

  private updateLight(id: number, level: number, pos: THREE.Vector3): void {
    let light = this.lights.get(id);
    if (!level) {
      dynamicLights.remove(`torch:${id}`);
      if (light) {
        this.scene.remove(light);
        this.lights.delete(id);
      }
      return;
    }
    if (!light) {
      light = new THREE.PointLight(TORCH_LIGHT_COLOR, TORCH_LIGHT_INTENSITY, 1, 1.4);
      this.scene.add(light);
      this.lights.set(id, light);
    }
    light.distance = torchRadius(level);
    light.position.set(pos.x, pos.y + TORCH_LIGHT_HEIGHT, pos.z);
    dynamicLights.set(`torch:${id}`, light.position, TORCH_LIGHT_COLOR, TORCH_DYNAMIC_INTENSITY, light.distance, 0.08);
  }

  get count(): number {
    return this.byId.size;
  }

  spawn(id: number, info: EntityInfo): void {
    if (this.byId.has(id)) return;
    const kind: AvatarKind = info.kind === 'mob' ? ((info.archetype ?? 'skeleton_warrior') as AvatarKind) : 'player';
    const look = info.kind === 'mob' && info.placement !== undefined ? this.placementLook(info.placement) : undefined;
    const avatar: Avatar = this.originals?.(kind, look?.held) ?? new ProceduralAvatar(kind);
    if (look?.talkState) avatar.setTalkState?.(look.talkState);
    const scale = info.scale ?? look?.scale;
    if (scale) avatar.setScale?.(scale);
    avatar.object.visible = false; // until the first sample arrives
    avatar.seed = id;
    this.scene.add(avatar.object);
    this.byId.set(id, { id, info, avatar, visible: false, hp: info.maxHp, swingId: 0, lastPhase: 0 });
  }

  /** Removes every remote entity (zone change). */
  clear(): void {
    for (const id of [...this.byId.keys()]) this.despawn(id);
  }

  /**
   * Fades an entity out over `seconds` (it keeps moving meanwhile). Its materials may be shared
   * with other avatars, so the opacity is set around each of its meshes' own draws only.
   */
  fade(id: number, seconds: number): void {
    const e = this.byId.get(id);
    if (!e || this.fades.has(id)) return;
    const f = { left: Math.max(0.05, seconds), total: Math.max(0.05, seconds) };
    this.fades.set(id, f);
    const saved = new Map<THREE.Material, { transparent: boolean; opacity: number }>();
    e.avatar.object.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh && !(o as THREE.Sprite).isSprite) return;
      o.onBeforeRender = (_r, _s, _c, _g, material) => {
        saved.set(material, { transparent: material.transparent, opacity: material.opacity });
        material.transparent = true;
        material.opacity *= Math.max(0, f.left / f.total);
      };
      o.onAfterRender = (_r, _s, _c, _g, material) => {
        const s = saved.get(material);
        if (!s) return;
        material.transparent = s.transparent;
        material.opacity = s.opacity;
      };
    });
  }

  /** A combat event killed this entity: its death plays now, not when the snapshots catch up. */
  kill(id: number): void {
    const e = this.byId.get(id);
    if (!e || this.scripted.has(id)) return;
    e.killed = true;
    e.hp = 0;
    e.avatar.setUpperSwing?.(null, 0);
    e.avatar.setShield?.(false);
    e.avatar.setState(ANIM.DEAD, 0, e.swingId);
  }

  despawn(id: number): void {
    const e = this.byId.get(id);
    this.fades.delete(id);
    if (!e) return;
    this.scene.remove(e.avatar.object);
    e.avatar.dispose();
    this.byId.delete(id);
    this.rates.delete(id);
    this.updateLight(id, 0, e.avatar.object.position);
  }

  update(session: ClientSession, dt: number): void {
    for (const [id, f] of this.fades) {
      f.left -= dt;
      const e = this.byId.get(id);
      if (e && f.left <= 0) e.avatar.object.visible = false; // gone; its despawn follows
    }
    const renderTick = session.estimateServerTick() - INTERP_DELAY_TICKS;
    for (const e of this.byId.values()) {
      if (this.scripted.has(e.id)) {
        e.avatar.update(dt);
        continue;
      }
      if (!session.sampleRemote(e.id, renderTick, this.sample)) continue;
      e.visible = true;
      e.avatar.object.visible = (this.fades.get(e.id)?.left ?? 1) > 0;
      e.avatar.object.position.set(this.sample.x, this.sample.y, this.sample.z);
      e.avatar.object.rotation.y = this.sample.yaw;
      if (e.killed && this.sample.anim === ANIM.DEAD) e.killed = false;
      if (e.killed) {
        e.hp = 0;
        e.avatar.update(dt * (this.rates.get(e.id) ?? 1));
        continue;
      }
      e.hp = this.sample.hp;
      const arch = e.info.archetype ? MOB_ARCHETYPES[e.info.archetype] : undefined;
      const swing = arch ? arch.swing : null;
      const swingSeconds = swing ? (swing.startup + swing.active + swing.recovery) * TICK_DT : 0.55;
      if (this.sample.animPhase < e.lastPhase) e.swingId++;
      e.lastPhase = this.sample.animPhase;
      e.avatar.setState(this.sample.anim, swingSeconds, e.swingId);
      e.avatar.setShield?.((this.sample.flags & 1) !== 0);
      this.updateLight(e.id, (this.sample.flags >> 4) & 3, e.avatar.object.position);
      const upper = (this.sample.flags >> 1) & 3;
      const codes = e.info.kind === 'mob' ? MOB_UPPER_SWING_CODES : UPPER_SWING_CODES;
      e.avatar.setUpperSwing?.(upper ? codes[upper - 1]! : null, (this.sample.flags >> 3) & 1);
      e.avatar.update(dt * (this.rates.get(e.id) ?? 1));
    }
  }
}
