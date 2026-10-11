import { CS, INPUT_VALID_MASK } from '../opcodes.ts';

/**
 * One fixed-step input sample. Angles are kept quantized (uint16) everywhere so that
 * client prediction and server simulation consume bit-identical values.
 */
export interface InputFrame {
  clientTick: number;
  flags: number;
  yaw: number;
  pitch: number;
}

export const MAX_INPUT_FRAMES = 3;
const HEADER_BYTES = 6;
const FRAME_BYTES = 10;
export const INPUT_PACKET_MAX_BYTES = HEADER_BYTES + MAX_INPUT_FRAMES * FRAME_BYTES;

export function createInputFrame(): InputFrame {
  return { clientTick: 0, flags: 0, yaw: 0, pitch: 0 };
}

/** Writes CS_PLAYER_INPUT into `view` and returns the byte length. Frames must be ordered oldest first. */
export function encodeInput(view: DataView, ackSnapshotTick: number, frames: readonly InputFrame[]): number {
  const count = frames.length;
  if (count < 1 || count > MAX_INPUT_FRAMES) throw new RangeError(`frame count ${count} out of range`);
  view.setUint8(0, CS.PLAYER_INPUT);
  view.setUint8(1, count);
  view.setUint32(2, ackSnapshotTick >>> 0, true);
  let o = HEADER_BYTES;
  for (const f of frames) {
    view.setUint32(o, f.clientTick >>> 0, true);
    const flags = f.flags & INPUT_VALID_MASK;
    view.setUint8(o + 4, flags & 0xff);
    view.setUint8(o + 5, flags >>> 8);
    view.setUint16(o + 6, f.yaw & 0xffff, true);
    view.setUint16(o + 8, f.pitch & 0xffff, true);
    o += FRAME_BYTES;
  }
  return o;
}

export interface DecodedInputHeader {
  ackSnapshotTick: number;
  count: number;
}

/**
 * Decodes CS_PLAYER_INPUT into preallocated `out` frames (length >= MAX_INPUT_FRAMES).
 * Returns null on any structural violation; never throws on untrusted bytes.
 */
export function decodeInput(view: DataView, out: InputFrame[]): DecodedInputHeader | null {
  if (view.byteLength < HEADER_BYTES + FRAME_BYTES) return null;
  if (view.getUint8(0) !== CS.PLAYER_INPUT) return null;
  const count = view.getUint8(1);
  if (count < 1 || count > MAX_INPUT_FRAMES || out.length < count) return null;
  if (view.byteLength !== HEADER_BYTES + count * FRAME_BYTES) return null;
  const ackSnapshotTick = view.getUint32(2, true);
  let o = HEADER_BYTES;
  let prevTick = -1;
  for (let i = 0; i < count; i++) {
    const tick = view.getUint32(o, true);
    const flags = view.getUint8(o + 4) | (view.getUint8(o + 5) << 8);
    if (tick <= prevTick) return null;
    if ((flags & ~INPUT_VALID_MASK) !== 0) return null;
    const f = out[i]!;
    f.clientTick = tick;
    f.flags = flags;
    f.yaw = view.getUint16(o + 6, true);
    f.pitch = view.getUint16(o + 8, true);
    prevTick = tick;
    o += FRAME_BYTES;
  }
  return { ackSnapshotTick, count };
}
