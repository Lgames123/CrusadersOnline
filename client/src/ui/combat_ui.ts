import * as THREE from 'three';
import { CHARACTER_GROUPS, type CombatEvent, type MovementWorld } from '@crusaders/shared';
import type { RemoteEntities } from '../entities/remote_entities.ts';

const FLOAT_SECONDS = 1.1;

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}

/**
 * A creature's level against the player's: grey more than 3 below (its XP shrinks,
 * xpLevelFactor), green below, yellow even, orange above, red with a skull 6 or more above.
 */
function levelTone(gap: number): 'trivial' | 'easy' | 'even' | 'hard' | 'deadly' {
  if (gap < -3) return 'trivial';
  if (gap < 0) return 'easy';
  if (gap <= 2) return 'even';
  if (gap <= 5) return 'hard';
  return 'deadly';
}

/** Health bars above remote entities and floating damage numbers, as a DOM overlay. */
export class CombatUi {
  private readonly root: HTMLElement;
  private readonly bars = new Map<number, HTMLDivElement>();
  private floaters: Floater[] = [];
  private readonly v = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  /** The local player's level, against which creature levels are coloured. */
  playerLevel = 1;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** `targetPos` is the target's head position (world), `mine` = the local player is involved. */
  damage(event: CombatEvent, targetPos: THREE.Vector3, kind: 'dealt' | 'taken' | 'other'): void {
    if (event.rush) return; // a shield rush deals no damage: no number
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    el.textContent = event.blocked ? 'Blocked' : event.killed ? `${event.damage}!` : String(event.damage);
    if (event.reward) el.textContent += `  +${event.reward.xp} XP  +${event.reward.gold}g`;
    this.root.appendChild(el);
    this.floaters.push({ el, pos: targetPos.clone(), age: 0 });
  }

  /** Floating text at a world position (pickups, notices). */
  notice(text: string, at: THREE.Vector3): void {
    const el = document.createElement('div');
    el.className = 'floater notice';
    el.textContent = text;
    this.root.appendChild(el);
    this.floaters.push({ el, pos: at.clone(), age: 0 });
  }

  /**
   * Whether level geometry hides `to` from the camera (a ray from the eye stopping short of it).
   * Health bars of creatures behind walls and floors are not drawn.
   */
  private hidden(mw: MovementWorld | undefined, eye: THREE.Vector3, to: THREE.Vector3): boolean {
    if (!mw) return false;
    this.dir.subVectors(to, eye);
    const len = this.dir.length();
    if (len < 0.5) return false;
    this.dir.divideScalar(len);
    const hit = mw.world.castRay(new mw.rapier.Ray(eye, this.dir), len - 0.3, true, undefined, CHARACTER_GROUPS);
    return !!hit;
  }

  update(dt: number, camera: THREE.Camera, remotes: RemoteEntities, width: number, height: number, mw?: MovementWorld): void {
    camera.getWorldPosition(this.eye);
    // Health bars for visible remote entities.
    for (const e of remotes.byId.values()) {
      let bar = this.bars.get(e.id);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = `hpbar ${e.info.kind}`;
        bar.innerHTML = '<span class="name"></span><div class="track"><div class="fill"></div></div>';
        const name = bar.querySelector('.name') as HTMLElement;
        if (e.info.level !== undefined) {
          // A creature's level (mmoLevels), coloured by its gap to the player's.
          const lvl = document.createElement('span');
          lvl.className = 'lvl';
          lvl.textContent = `[Lv.${e.info.level}] `;
          name.append(lvl, e.info.name);
        } else name.textContent = e.info.name;
        this.root.appendChild(bar);
        this.bars.set(e.id, bar);
      }
      this.v.copy(e.avatar.object.position);
      this.v.y += e.avatar.headHeight;
      this.mid.copy(e.avatar.object.position);
      this.mid.y += e.avatar.headHeight * 0.5;
      // Seen when the head or the middle of the body is in sight.
      const inSight = !this.hidden(mw, this.eye, this.v) || !this.hidden(mw, this.eye, this.mid);
      const onScreen = e.visible && inSight && this.project(this.v, camera, width, height);
      bar.style.display = onScreen ? 'block' : 'none';
      if (!onScreen) continue;
      bar.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -100%)`;
      const frac = e.info.maxHp > 0 ? Math.max(0, e.hp) / e.info.maxHp : 0;
      (bar.querySelector('.fill') as HTMLElement).style.width = `${(frac * 100).toFixed(0)}%`;
      bar.classList.toggle('dead', e.hp <= 0);
      if (e.info.level !== undefined) {
        const tone = levelTone(e.info.level - this.playerLevel);
        if (bar.dataset.tone !== tone) bar.dataset.tone = tone;
      }
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
