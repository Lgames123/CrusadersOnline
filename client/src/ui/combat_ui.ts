import * as THREE from 'three';
import type { CombatEvent } from '@crusaders/shared';
import type { RemoteEntities } from '../entities/remote_entities.ts';

const FLOAT_SECONDS = 1.1;

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}

/** Health bars above remote entities and floating damage numbers, as a DOM overlay. */
export class CombatUi {
  private readonly root: HTMLElement;
  private readonly bars = new Map<number, HTMLDivElement>();
  private floaters: Floater[] = [];
  private readonly v = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** `targetPos` is the target's head position (world), `mine` = the local player is involved. */
  damage(event: CombatEvent, targetPos: THREE.Vector3, kind: 'dealt' | 'taken' | 'other'): void {
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    el.textContent = event.blocked ? 'Blocked' : event.killed ? `${event.damage}!` : String(event.damage);
    if (event.reward) el.textContent += `  +${event.reward.xp} XP  +${event.reward.gold}g${event.reward.loot ? `  ${event.reward.loot.join(', ')}` : ''}`;
    this.root.appendChild(el);
    this.floaters.push({ el, pos: targetPos.clone(), age: 0 });
  }

  update(dt: number, camera: THREE.Camera, remotes: RemoteEntities, width: number, height: number): void {
    // Health bars for visible remote entities.
    for (const e of remotes.byId.values()) {
      let bar = this.bars.get(e.id);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = `hpbar ${e.info.kind}`;
        bar.innerHTML = '<span class="name"></span><div class="track"><div class="fill"></div></div>';
        (bar.querySelector('.name') as HTMLElement).textContent = e.info.name;
        this.root.appendChild(bar);
        this.bars.set(e.id, bar);
      }
      this.v.copy(e.avatar.object.position);
      this.v.y += e.avatar.headHeight;
      const onScreen = e.visible && this.project(this.v, camera, width, height);
      bar.style.display = onScreen ? 'block' : 'none';
      if (!onScreen) continue;
      bar.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -100%)`;
      const frac = e.info.maxHp > 0 ? Math.max(0, e.hp) / e.info.maxHp : 0;
      (bar.querySelector('.fill') as HTMLElement).style.width = `${(frac * 100).toFixed(0)}%`;
      bar.classList.toggle('dead', e.hp <= 0);
    }
    for (const [id, bar] of this.bars) {
      if (!remotes.byId.has(id)) {
        bar.remove();
        this.bars.delete(id);
      }
    }

    // Damage numbers rise and fade.
    this.floaters = this.floaters.filter((f) => {
      f.age += dt;
      if (f.age > FLOAT_SECONDS) {
        f.el.remove();
        return false;
      }
      this.v.copy(f.pos);
      this.v.y += f.age * 0.8;
      const onScreen = this.project(this.v, camera, width, height);
      f.el.style.display = onScreen ? 'block' : 'none';
      f.el.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -100%)`;
      f.el.style.opacity = String(1 - f.age / FLOAT_SECONDS);
      return true;
    });
  }

  /** Projects in place to CSS pixels; false when behind the camera. */
  private project(v: THREE.Vector3, camera: THREE.Camera, width: number, height: number): boolean {
    v.project(camera);
    if (v.z > 1) return false;
    v.x = (v.x * 0.5 + 0.5) * width;
    v.y = (-v.y * 0.5 + 0.5) * height;
    return true;
  }
}
