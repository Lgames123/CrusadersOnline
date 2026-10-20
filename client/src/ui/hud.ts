import type { Character, ClientSession, PlayerStats } from '@crusaders/shared';
import { BUILTIN_SPELLS, SPELL_NAMES, STATUS_NAMES, xpForLevel } from '@crusaders/shared';
import type { ClassicHud } from './classic_hud.ts';

export type HudStyle = 'classic' | 'modern';

/**
 * The player's HUD in the top left corner — the original's coins (classic) or the panel (HP,
 * level/XP, mana, spell, gold; modern) — the performance stats line (optional) and the death
 * notice.
 */
export class Hud {
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private readonly debug: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly classic: ClassicHud;
  private readonly death: HTMLElement;
  private style_: HudStyle = 'classic';
  private hasStats = false;

  constructor(debug: HTMLElement, panel: HTMLElement, classic: ClassicHud, death: HTMLElement) {
    this.debug = debug;
    this.panel = panel;
    this.classic = classic;
    this.death = death;
    this.showStats = false;
  }

  set style(style: HudStyle) {
    this.style_ = style;
    this.show();
  }

  /** FPS, tick, position and network line (top right). */
  set showStats(on: boolean) {
    this.debug.hidden = !on;
  }

  private show(): void {
    this.panel.hidden = !this.hasStats || this.style_ !== 'modern';
    this.classic.visible = this.hasStats && this.style_ === 'classic';
  }

  /** The server's feature mmoLevels (SC_WORLD_ENTER): the XP bar follows the MMO curve. */
  mmoLevels = false;

  stats(s: PlayerStats): void {
    this.hasStats = true;
    this.show();
    this.classic.update(s);
    const hpPct = s.maxHp > 0 ? (100 * s.hp) / s.maxHp : 0;
    // Original curve: thresholds 500, 1500, 3500, ... (xpForLevel); the MMO one with mmoLevels.
    const from = xpForLevel(s.level, this.mmoLevels);
    const span = Math.max(1, xpForLevel(s.level + 1, this.mmoLevels) - from);
    const xpInto = s.xp - from;
    this.panel.innerHTML = `
      <div class="row"><span>HP</span><div class="track hp"><div class="fill" style="width:${hpPct.toFixed(0)}%"></div></div><span>${s.hp}/${s.maxHp}</span></div>
      <div class="row"><span>Lv ${s.level}</span><div class="track xp"><div class="fill" style="width:${Math.min(100, (100 * xpInto) / span).toFixed(0)}%"></div></div><span>${xpInto}/${span}</span></div>
      <div class="row"><span>MP</span><div class="track mp"><div class="fill" style="width:${(s.maxMana > 0 ? (100 * s.mana) / s.maxMana : 0).toFixed(0)}%"></div></div><span>${s.mana}/${s.maxMana}</span></div>
      ${s.spell ? this.spellRow(s) : ''}
      ${s.statuses?.length ? `<div class="row spell">${s.statuses.map((x) => STATUS_NAMES[x.tag]).join(' · ')}</div>` : ''}
      <div class="row gold">${s.gold} gold</div>`;
    this.death.hidden = !s.dead;
  }

  /** The selected spell, its level and mana cost (T cycles, R casts). */
  private spellRow(s: PlayerStats): string {
    const level = s.spells.find((k) => k.spell === s.spell)?.level ?? 1;
    const cost = s.spell ? BUILTIN_SPELLS[s.spell]?.[level - 1]?.mana : undefined;
    return `<div class="row spell">${SPELL_NAMES[s.spell!]} ${level}${cost !== undefined ? ` <span style="opacity:.7">(${cost} MP)</span>` : ''}</div>`;
  }

  update(dt: number, tick: number, c: Character, session: ClientSession | null, remotes: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.25) return;
    if (this.debug.hidden) {
      this.frames = 0;
      this.acc = 0;
      return;
    }
    this.fps = Math.round(this.frames / this.acc);
    this.frames = 0;
    this.acc = 0;
    const p = c.position;
    let net = 'OFFLINE (no server)';
    if (session) {
      const s = session.stats;
      net = session.connected
        ? `ONLINE as ${session.accountName}  rtt ${s.rttMs.toFixed(0)}ms  entities ${remotes + 1}  corrections ${s.corrections}`
        : 'DISCONNECTED';
    }
    this.debug.textContent =
      `FPS ${this.fps}  tick ${tick}\n` +
      `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  ${c.grounded ? 'grounded' : 'airborne'}\n` +
      net;
  }
}
