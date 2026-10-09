/** Token bucket: `rate` tokens per second, holding at most `burst`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly burst: number;
  private readonly now: () => number;

  constructor(rate: number, burst: number, now: () => number = () => performance.now()) {
    this.rate = rate;
    this.burst = burst;
    this.now = now;
    this.tokens = burst;
    this.last = now();
  }

  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
