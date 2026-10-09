import type { Character } from '@crusaders/shared';

/** Minimal debug HUD: frame rate, tick counter and local player state. */
export class Hud {
  private frames = 0;
  private acc = 0;
  private fps = 0;

  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  update(dt: number, tick: number, c: Character): void {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.fps = Math.round(this.frames / this.acc);
    this.frames = 0;
    this.acc = 0;
    const p = c.position;
    this.el.textContent =
      `FPS ${this.fps}  tick ${tick}\n` +
      `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  ${c.grounded ? 'grounded' : 'airborne'}`;
  }
}
