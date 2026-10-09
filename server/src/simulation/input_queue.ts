import { createInputFrame, type InputFrame } from '@crusaders/shared';

/**
 * Per-player input buffer. Exactly one frame is consumed per server tick, so sending
 * inputs faster never makes a character move faster (ADR-006). Duplicates from the
 * 3-frame redundancy are discarded by tick number; overflow drops the oldest frames.
 */
export class InputQueue {
  static readonly CAPACITY = 4;

  private readonly ring: InputFrame[] = Array.from({ length: InputQueue.CAPACITY }, createInputFrame);
  private head = 0;
  private count = 0;
  /** Highest clientTick ever accepted. */
  lastQueuedTick = -1;
  dropped = 0;

  push(f: Readonly<InputFrame>): void {
    if (f.clientTick <= this.lastQueuedTick) return;
    if (this.count === InputQueue.CAPACITY) {
      this.head = (this.head + 1) % InputQueue.CAPACITY;
      this.count--;
      this.dropped++;
    }
    const slot = this.ring[(this.head + this.count) % InputQueue.CAPACITY]!;
    slot.clientTick = f.clientTick;
    slot.flags = f.flags;
    slot.yaw = f.yaw;
    slot.pitch = f.pitch;
    this.count++;
    this.lastQueuedTick = f.clientTick;
  }

  /** Copies the oldest frame into `out`; returns false when empty. */
  shift(out: InputFrame): boolean {
    if (this.count === 0) return false;
    const f = this.ring[this.head]!;
    out.clientTick = f.clientTick;
    out.flags = f.flags;
    out.yaw = f.yaw;
    out.pitch = f.pitch;
    this.head = (this.head + 1) % InputQueue.CAPACITY;
    this.count--;
    return true;
  }

  get length(): number {
    return this.count;
  }
}
