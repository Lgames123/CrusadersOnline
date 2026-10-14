import * as THREE from 'three';
import {
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
import type { AvatarFactory } from '../assets/original_models.ts';
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
}

/** Other players and mobs, rendered 100 ms in the past and interpolated between snapshots. */
export class RemoteEntities {
  readonly byId = new Map<number, RemoteEntity>();
  private readonly scene: THREE.Scene;
  private readonly originals: AvatarFactory | null;
  private readonly sample: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, animPhase: 0, hp: 0, flags: 0 };

  /** Entities a scripted sequence is playing on this client: not moved by snapshots meanwhile. */
  readonly scripted = new Set<number>();

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
    const avatar = this.originals?.(kind) ?? new ProceduralAvatar(kind);
    avatar.object.visible = false; // until the first sample arrives
    avatar.seed = id;
    this.scene.add(avatar.object);
    this.byId.set(id, { id, info, avatar, visible: false, hp: info.maxHp, swingId: 0, lastPhase: 0 });
  }

  /** Removes every remote entity (zone change). */
  clear(): void {
    for (const id of [...this.byId.keys()]) this.despawn(id);
  }

  despawn(id: number): void {
    const e = this.byId.get(id);
    if (!e) return;
    this.scene.remove(e.avatar.object);
    e.avatar.dispose();
    this.byId.delete(id);
    this.updateLight(id, 0, e.avatar.object.position);
  }

  update(session: ClientSession, dt: number): void {
    const renderTick = session.estimateServerTick() - INTERP_DELAY_TICKS;
    for (const e of this.byId.values()) {
      if (this.scripted.has(e.id)) {
        e.avatar.update(dt);
        continue;
      }
      if (!session.sampleRemote(e.id, renderTick, this.sample)) continue;
      e.visible = e.avatar.object.visible = true;
      e.avatar.object.position.set(this.sample.x, this.sample.y, this.sample.z);
      e.avatar.object.rotation.y = this.sample.yaw;
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
      e.avatar.update(dt);
    }
  }
}
