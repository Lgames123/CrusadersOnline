import * as THREE from 'three';
import {
  INTERP_DELAY_TICKS,
  MOB_ARCHETYPES,
  TICK_DT,
  type ClientSession,
  type EntityInfo,
  type RemoteSample,
} from '@crusaders/shared';
import { ProceduralAvatar, type Avatar, type AvatarKind } from './avatar.ts';
import type { AvatarFactory } from '../assets/original_models.ts';

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
  private readonly sample: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, animPhase: 0, hp: 0 };

  constructor(scene: THREE.Scene, originals: AvatarFactory | null) {
    this.scene = scene;
    this.originals = originals;
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
  }

  update(session: ClientSession, dt: number): void {
    const renderTick = session.estimateServerTick() - INTERP_DELAY_TICKS;
    for (const e of this.byId.values()) {
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
      e.avatar.update(dt);
    }
  }
}
