import type { Character, ClientSession, PlayerStats } from '@crusaders/shared';
import { XP_PER_LEVEL } from '@crusaders/shared';

/** Debug line plus the player panel (HP, level/XP, gold) and the death notice. */
export class Hud {
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private readonly debug: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly death: HTMLElement;

  constructor(debug: HTMLElement, panel: HTMLElement, death: HTMLElement) {
    this.debug = debug;
    this.panel = panel;
    this.death = death;
  }

  stats(s: PlayerStats): void {
    this.panel.hidden = false;
    const hpPct = s.maxHp > 0 ? (100 * s.hp) / s.maxHp : 0;
    const xpInto = s.xp % XP_PER_LEVEL;
    this.panel.innerHTML = `
      <div class="row"><span>HP</span><div class="track hp"><div class="fill" style="width:${hpPct.toFixed(0)}%"></div></div><span>${s.hp}/${s.maxHp}</span></div>
      <div class="row"><span>Lv ${s.level}</span><div class="track xp"><div class="fill" style="width:${((100 * xpInto) / XP_PER_LEVEL).toFixed(0)}%"></div></div><span>${xpInto}/${XP_PER_LEVEL}</span></div>
      <div class="row gold">${s.gold} gold</div>`;
    this.death.hidden = !s.dead;
  }

  update(dt: number, tick: number, c: Character, session: ClientSession | null, remotes: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.25) return;
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
