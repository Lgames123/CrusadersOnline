import { describe, expect, it } from 'vitest';
import { AniError, evaluateChannel, parseAni } from '@crusaders/converter';

// Synthetic .ani following docs/reverse-engineering/asset-format-discovery.md §4.
// Bone 0: cubic rotation (1 segment) + cubic translation (1 segment).
// Bone 1: constant rotation, no translation. Bone 2: no channels.
// One event "hit" at 4800 ticks (= 30 frames).
function buildFixture(): Uint8Array {
  const words: number[] = [];
  const f = (x: number) => {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, x, true);
    return dv.getUint32(0, true);
  };
  // flags: bone0 nibble 0xF (rot cubic + trans cubic), bone1 nibble 0x2 (rot constant)
  words.push(0x2f);
  // bone 0 rotation: n=1, times [0, 10], coefficients [a0..a3, b0..b3, c0..c3, d0..d3]
  words.push(1, f(0), f(10));
  // stored component order is (w, x, y, z): w(t) = 0.1 t + 1
  [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 1, 0, 0, 0].forEach((x) => words.push(f(x)));
  // bone 0 translation: n=1, times [0, 10]; x(t) = 2t, y(t) = t^2, z(t) = 5
  words.push(1, f(0), f(10));
  [0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 5].forEach((x) => words.push(f(x)));
  // bone 1 constant rotation, stored (w, x, y, z) = (0.8, 0, 0.6, 0)
  [0.8, 0, 0.6, 0].forEach((x) => words.push(f(x)));

  const data = new Uint8Array(words.length * 4);
  new DataView(data.buffer).setUint32(0, 0, true);
  words.forEach((w, i) => new DataView(data.buffer).setUint32(i * 4, w, true));
  const events = new TextEncoder().encode('hit\0');
  const total = 0x38 + data.length + 8 + 4 + events.length;
  const b = new Uint8Array(total);
  const dv = new DataView(b.buffer);
  dv.setFloat32(0x04, 1 / 30, true);
  dv.setUint32(0x34, data.length, true);
  b.set(data, 0x38);
  const o = 0x38 + data.length;
  dv.setUint32(o, 1, true);
  dv.setUint32(o + 4, events.length, true);
  dv.setFloat32(o + 8, 4800, true);
  b.set(events, o + 12);
  return b;
}

describe('.ani parser and evaluator', () => {
  it('walks the per-bone channel stream with packed nibble flags', () => {
    const clip = parseAni(buildFixture(), 3);
    expect(clip.bones[0]?.rotation?.kind).toBe('cubic');
    expect(clip.bones[0]?.translation?.kind).toBe('cubic');
    // returned as (x, y, z, w)
    expect(clip.bones[1]).toEqual({ rotation: { kind: 'constant', value: [0, expect.closeTo(0.6), 0, expect.closeTo(0.8)] }, translation: null });
    expect(clip.bones[2]).toBeNull();
    expect(clip.endFrame).toBe(10);
  });

  it('evaluates cubic polynomials in absolute frame time and clamps outside the range', () => {
    const clip = parseAni(buildFixture(), 3);
    const out = [0, 0, 0, 0];
    evaluateChannel(clip.bones[0]!.translation!, 3, out);
    expect(out.slice(0, 3)).toEqual([6, 9, 5]);
    evaluateChannel(clip.bones[0]!.translation!, 99, out);
    expect(out.slice(0, 3)).toEqual([20, 100, 5]);
    evaluateChannel(clip.bones[0]!.rotation!, 5, out);
    expect(out[3]).toBeCloseTo(1.5);
  });

  it('converts 3ds Max tick event times to frames like the engine', () => {
    expect(parseAni(buildFixture(), 3).events).toEqual([{ frame: 30, name: 'hit' }]);
  });

  it('rejects a stream that does not match the skeleton', () => {
    const b = buildFixture();
    // Claim one byte less of keyframe data than the stream needs.
    new DataView(b.buffer).setUint32(0x34, new DataView(b.buffer).getUint32(0x34, true) - 4, true);
    expect(() => parseAni(b, 3)).toThrow(AniError);
  });
});
