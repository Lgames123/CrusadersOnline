/**
 * Parser and evaluator for the original game's `.ani` animations. Specification:
 * docs/reverse-engineering/asset-format-discovery.md §4 (derived from the game's evaluator).
 * Pure: no Node or DOM APIs.
 *
 * Each bone (in model node order) has an optional rotation track (quaternion) and translation
 * track, each either a constant or a piecewise cubic polynomial in absolute frame time:
 * v(t) = ((a·t + b)·t + c)·t + d, segments delimited by n+1 break times (frames, 30 fps).
 */
export class AniError extends Error {}

export interface CubicTrack {
  /** n+1 break times, in frames. */
  times: Float32Array;
  /** n segments × components × 4 coefficients, stored [a0..ak, b0..bk, c0..ck, d0..dk] per segment. */
  coefficients: Float32Array;
  components: 3 | 4;
}

export type Channel = { kind: 'constant'; value: number[] } | { kind: 'cubic'; track: CubicTrack };

export interface BoneChannels {
  rotation: Channel | null;
  translation: Channel | null;
}

export interface AniEvent {
  frame: number;
  name: string;
}

export interface AniClip {
  /** Bones in model node order; trailing bones without channels are null. */
  bones: (BoneChannels | null)[];
  /** Last break time over all tracks, in frames. */
  endFrame: number;
  events: AniEvent[];
}

export const ANI_FPS = 30;
const HEADER_SIZE = 0x38;
/** Event times above this are 3ds Max ticks (4800/s) rather than frames (engine behaviour). */
const TICKS_THRESHOLD = 500;
const MAX_KEYS = 10_000;

export function parseAni(bytes: Uint8Array, boneCount: number): AniClip {
  if (bytes.length < HEADER_SIZE + 8) throw new AniError('file shorter than header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = dv.getUint32(0x34, true);
  const dataEnd = HEADER_SIZE + dataSize;
  if (dataSize % 4 !== 0 || dataEnd + 8 > bytes.length) throw new AniError('data size out of range');

  let p = HEADER_SIZE;
  const word = () => {
    if (p + 4 > dataEnd) throw new AniError('keyframe data truncated');
    const v = dv.getUint32(p, true);
    p += 4;
    return v;
  };
  const floats = (n: number) => {
    if (p + n * 4 > dataEnd) throw new AniError('keyframe data truncated');
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getFloat32(p + i * 4, true);
    p += n * 4;
    return out;
  };
  const cubic = (components: 3 | 4): Channel => {
    const n = word();
    if (n === 0 || n > MAX_KEYS) throw new AniError(`bad key count ${n}`);
    const times = floats(n + 1);
    const coefficients = floats(n * components * 4);
    return { kind: 'cubic', track: { times, coefficients, components } };
  };

  // Rotations are stored (w, x, y, z) in .ani (unlike .mdl's (x, y, z, w)); reorder once here so
  // every evaluated quaternion is (x, y, z, w).
  const toXyzw = (c: Channel): Channel => {
    if (c.kind === 'constant') {
      const [w, x, y, z] = c.value as [number, number, number, number];
      return { kind: 'constant', value: [x, y, z, w] };
    }
    const k = c.track.coefficients;
    const out = new Float32Array(k.length);
    for (let base = 0; base < k.length; base += 4) {
      // each group of 4 is one coefficient (a, b, c or d) for components w, x, y, z
      out[base] = k[base + 1]!;
      out[base + 1] = k[base + 2]!;
      out[base + 2] = k[base + 3]!;
      out[base + 3] = k[base]!;
    }
    return { kind: 'cubic', track: { ...c.track, coefficients: out } };
  };

  const bones: (BoneChannels | null)[] = [];
  let endFrame = 0;
  let flags = 0;
  for (let b = 0; b < boneCount; b++) {
    if (p >= dataEnd && flags === 0) {
      bones.push(null);
      continue;
    }
    if (flags === 0) flags = word();
    let rotation: Channel | null = null;
    let translation: Channel | null = null;
    if (flags & 2) rotation = toXyzw(flags & 1 ? cubic(4) : { kind: 'constant', value: Array.from(floats(4)) });
    if (flags & 8) translation = flags & 4 ? cubic(3) : { kind: 'constant', value: Array.from(floats(3)) };
    for (const c of [rotation, translation]) {
      if (c?.kind === 'cubic') endFrame = Math.max(endFrame, c.track.times[c.track.times.length - 1]!);
    }
    bones.push(rotation || translation ? { rotation, translation } : null);
    flags >>>= 4;
  }
  if (p !== dataEnd) throw new AniError(`keyframe stream used ${p - HEADER_SIZE} of ${dataSize} bytes (wrong skeleton?)`);

  // Event track: u32 count, u32 names size, f32 times[count], NUL-separated names.
  const count = dv.getUint32(dataEnd, true);
  const namesSize = dv.getUint32(dataEnd + 4, true);
  const events: AniEvent[] = [];
  if (count > 0) {
    const timesAt = dataEnd + 8;
    const namesAt = timesAt + count * 4;
    if (namesAt + namesSize > bytes.length) throw new AniError('event track truncated');
    const names = new TextDecoder('latin1').decode(bytes.subarray(namesAt, namesAt + namesSize)).split('\0');
    for (let i = 0; i < count; i++) {
      let frame = dv.getFloat32(timesAt + i * 4, true);
      if (frame > TICKS_THRESHOLD) frame = (frame / 4800) * ANI_FPS;
      events.push({ frame, name: names[i] ?? '' });
    }
  }
  return { bones, endFrame, events };
}

/** Evaluates a channel at `frame` into `out` (clamped to the track's time range). */
export function evaluateChannel(channel: Channel, frame: number, out: number[]): void {
  if (channel.kind === 'constant') {
    for (let k = 0; k < channel.value.length; k++) out[k] = channel.value[k]!;
    return;
  }
  const { times, coefficients, components } = channel.track;
  const n = times.length - 1;
  const t = Math.min(Math.max(frame, times[0]!), times[n]!);
  let seg = 0;
  while (seg < n - 1 && times[seg + 1]! < t) seg++;
  const base = seg * components * 4;
  for (let k = 0; k < components; k++) {
    const a = coefficients[base + k]!;
    const b = coefficients[base + components + k]!;
    const c = coefficients[base + 2 * components + k]!;
    const d = coefficients[base + 3 * components + k]!;
    out[k] = ((a * t + b) * t + c) * t + d;
  }
}
