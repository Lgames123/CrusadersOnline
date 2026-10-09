import { performance } from 'node:perf_hooks';
import { TICK_MS } from '@crusaders/shared';

const MAX_CATCHUP_MS = 250; // clamp the spiral of death
const WAKE_EARLY_MS = 2;

/**
 * Fixed-step accumulator on a monotonic clock (engine-design.md §2). A coarse setTimeout
 * wakes the loop slightly early; the accumulator decides how many steps to run.
 */
export class SimulationClock {
  tick = 0;
  private last = 0;
  private acc = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly stepMs: number;

  constructor(stepMs = TICK_MS) {
    this.stepMs = stepMs;
  }

  start(step: (tick: number) => void): void {
    this.last = performance.now();
    const loop = () => {
      const now = performance.now();
      this.acc += Math.min(now - this.last, MAX_CATCHUP_MS);
      this.last = now;
      while (this.acc >= this.stepMs) {
        step(++this.tick);
        this.acc -= this.stepMs;
      }
      this.timer = setTimeout(loop, Math.max(0, this.stepMs - this.acc - WAKE_EARLY_MS));
    };
    this.timer = setTimeout(loop, this.stepMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Rolling tick-duration statistics for metrics/logging. */
export class TickStats {
  private samples: number[] = [];
  late = 0;

  record(ms: number, budgetMs = TICK_MS): void {
    this.samples.push(ms);
    if (ms > budgetMs * 0.9) this.late++;
  }

  drain(): { count: number; p50: number; p99: number; max: number; late: number } {
    const s = this.samples.sort((a, b) => a - b);
    const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
    const out = { count: s.length, p50: at(0.5), p99: at(0.99), max: s[s.length - 1] ?? 0, late: this.late };
    this.samples = [];
    this.late = 0;
    return out;
  }
}
