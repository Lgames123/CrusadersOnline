import { describe, expect, it } from 'vitest';
import {
  CS,
  INPUT,
  INPUT_PACKET_MAX_BYTES,
  MAX_INPUT_FRAMES,
  createEntityState,
  createInputFrame,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  parseClientControl,
  quantizeAngle,
  dequantizeAngle,
  snapshotMaxBytes,
  type EntityState,
  type InputFrame,
  type SnapshotHeader,
} from '@crusaders/shared';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const outFrames = (): InputFrame[] => Array.from({ length: MAX_INPUT_FRAMES }, createInputFrame);

describe('CS_PLAYER_INPUT codec', () => {
  it('round-trips frames', () => {
    const view = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    const frames: InputFrame[] = [
      { clientTick: 10, flags: INPUT.FORWARD | INPUT.JUMP, yaw: 1234, pitch: 65000 },
      { clientTick: 11, flags: INPUT.LEFT, yaw: 0, pitch: 1 },
    ];
    const len = encodeInput(view, 77, frames);
    expect(len).toBe(26);
    const out = outFrames();
    const h = decodeInput(new DataView(view.buffer, 0, len), out);
    expect(h).toEqual({ ackSnapshotTick: 77, count: 2 });
    expect(out.slice(0, 2)).toEqual(frames);
  });

  it('rejects malformed packets', () => {
    const view = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    const len = encodeInput(view, 1, [{ clientTick: 5, flags: 1, yaw: 0, pitch: 0 }]);
    const out = outFrames();
    expect(decodeInput(new DataView(view.buffer, 0, len - 1), out)).toBeNull(); // truncated
    const bad = new Uint8Array(view.buffer.slice(0, len));
    bad[6 + 5] = 0b1000_0000; // unknown flag bit (second flags byte)
    expect(decodeInput(new DataView(bad.buffer), out)).toBeNull();
    const wrongOp = new Uint8Array(view.buffer.slice(0, len));
    wrongOp[0] = CS.PING;
    expect(decodeInput(new DataView(wrongOp.buffer), out)).toBeNull();
  });

  it('rejects non-increasing ticks inside one packet', () => {
    const view = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    const len = encodeInput(view, 0, [
      { clientTick: 9, flags: 0, yaw: 0, pitch: 0 },
      { clientTick: 9, flags: 0, yaw: 0, pitch: 0 },
    ]);
    expect(decodeInput(new DataView(view.buffer, 0, len), outFrames())).toBeNull();
  });

  it('never throws on random bytes', () => {
    const r = rng(42);
    const out = outFrames();
    for (let i = 0; i < 5000; i++) {
      const bytes = new Uint8Array(Math.floor(r() * 48));
      for (let j = 0; j < bytes.length; j++) bytes[j] = Math.floor(r() * 256);
      if (bytes.length > 0 && r() < 0.5) bytes[0] = CS.PLAYER_INPUT;
      expect(() => decodeInput(new DataView(bytes.buffer), out)).not.toThrow();
    }
  });
});

describe('angle quantization', () => {
  it('wraps and stays within one step of error', () => {
    for (const a of [0, 1, Math.PI, -Math.PI / 2, 7 * Math.PI]) {
      const back = dequantizeAngle(quantizeAngle(a));
      const diff = Math.abs(Math.atan2(Math.sin(a - back), Math.cos(a - back)));
      expect(diff).toBeLessThan((2 * Math.PI) / 65536);
    }
  });
});

describe('SC_WORLD_SNAPSHOT codec', () => {
  const header = (tick: number, baseline: number): SnapshotHeader => ({
    serverTick: tick,
    baselineTick: baseline,
    lastProcessedInput: 900,
    selfVelY: -1234,
    selfGrounded: true,
    selfRollDir: 3,
    selfRollTicks: 12,
  });

  const state = (id: number, x: number, hp = 100): EntityState => ({ ...createEntityState(id), x, y: 50, z: -x, yaw: 300, hp });

  function encode(cur: Map<number, EntityState>, base: Map<number, EntityState> | null, h: SnapshotHeader) {
    const view = new DataView(new ArrayBuffer(snapshotMaxBytes(cur.size, base?.size ?? 0)));
    const len = encodeSnapshot(view, h, cur, base);
    return new DataView(view.buffer, 0, len);
  }

  it('round-trips a full snapshot', () => {
    const cur = new Map([[1, state(1, 1000)], [2, state(2, -5000)]]);
    const out = new Map<number, EntityState>();
    const h = decodeSnapshot(encode(cur, null, header(10, 0)), null, out);
    expect(h).toEqual(header(10, 0));
    expect(out).toEqual(cur);
  });

  it('delta omits unchanged entities and lists removals', () => {
    const base = new Map([[1, state(1, 1000)], [2, state(2, 2000)], [3, state(3, 3000)]]);
    const cur = new Map([[1, state(1, 1000)], [2, state(2, 2100, 90)], [4, state(4, 4000)]]);
    const view = encode(cur, base, header(12, 10));
    const full = encode(cur, null, header(12, 0));
    expect(view.byteLength).toBeLessThan(full.byteLength);
    const out = new Map<number, EntityState>();
    const h = decodeSnapshot(view, base, out);
    expect(h?.baselineTick).toBe(10);
    expect(out).toEqual(cur);
  });

  it('refuses a delta without the baseline', () => {
    const base = new Map([[1, state(1, 1000)]]);
    const view = encode(new Map([[1, state(1, 1001)]]), base, header(3, 2));
    expect(decodeSnapshot(view, null, new Map())).toBeNull();
  });

  it('never throws on random bytes', () => {
    const r = rng(7);
    const base = new Map([[1, state(1, 1)]]);
    for (let i = 0; i < 5000; i++) {
      const bytes = new Uint8Array(Math.floor(r() * 80));
      for (let j = 0; j < bytes.length; j++) bytes[j] = Math.floor(r() * 256);
      if (bytes.length > 0) bytes[0] = 0x42;
      expect(() => decodeSnapshot(new DataView(bytes.buffer), base, new Map())).not.toThrow();
    }
  });
});

describe('control message schemas', () => {
  it('accepts valid and rejects malformed payloads', () => {
    const ticket = 'A'.repeat(43);
    expect(parseClientControl(JSON.stringify({ op: CS.AUTH_TICKET, seq: 0, d: { ticket } }))).not.toBeNull();
    expect(parseClientControl(JSON.stringify({ op: CS.AUTH_TICKET, seq: 0, d: { ticket: 'short' } }))).toBeNull();
    expect(parseClientControl(JSON.stringify({ op: CS.PLAYER_ATTACK, seq: 1, d: { comboIndex: 9, clientTick: 1 } }))).toBeNull();
    expect(parseClientControl('{not json')).toBeNull();
    expect(parseClientControl('x'.repeat(5000))).toBeNull();
  });
});
