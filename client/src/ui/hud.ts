import type { Character, ClientSession } from '@crusaders/shared';

/** Minimal debug HUD: frame rate, tick, local player state and network stats. */
export class Hud {
  private frames = 0;
  private acc = 0;
  private fps = 0;

  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
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
        ? `ONLINE as ${session.accountName}  rtt ${s.rttMs.toFixed(0)}ms  players ${remotes + 1}  corrections ${s.corrections}`
        : 'DISCONNECTED';
    }
    this.el.textContent =
      `FPS ${this.fps}  tick ${tick}\n` +
      `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  ${c.grounded ? 'grounded' : 'airborne'}\n` +
      net;
  }
}
