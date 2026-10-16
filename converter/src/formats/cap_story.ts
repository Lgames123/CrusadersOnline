/**
 * The story layer of a level act (asset-format-discovery.md §6.5): trigger objects, scripted
 * sequences (the cutscenes) and their cameras, read from a decompressed `.cap` image.
 *
 * The cap DB ends with a per-type object table (225 types: for each, a count and that many
 * pointers; the loader 0x478xxx patches each object's vtable by type). The types read here:
 *   0x13  exit trigger (its portal record embedded at +0x34)
 *   0x14  flag trigger: +4 volume, +8 activation (1 = walked into); set by entering the volume or
 *         by a TriggerFlag step (vtable slots 0x462A70 / 0x462B00)
 *   0x1A  message trigger (signs): +4 volume, +8 activation (bit 0 walked into, bit 3 use key,
 *         0x200 once), +0x34 messages.ctx index; fired by 0x4632B0 (vtable 0x4E19D4 slot 5),
 *         which shows the message on the HUD for 2000 ms
 *   0x1D  quest trigger: +4 volume, +8 activation, +0x0E action mask, +0x34 quest index,
 *         +0x36 player bit (fired by 0x4641F0)
 *   0x28  camera: +0x34 eye path (type 0x55), +0x38 look-at path (type 0x53)
 *   0x2B  relay trigger: fires its targets (+0x36 count, +0x38 pointer array; 0x462B90)
 *   0x40  action definition: +8 name, +0x3C argument names (0x33 bytes each), +4..+7 header
 *   0x4D  sequence binding: +0x10 typed reference to the flag trigger that starts it, +0x18 the
 *         sequence's camera, +0x20 the sequence definition, +0x28 actor count, +0x2C actor table
 * A sequence definition: +2 track count, +0x14 its name, +3 actor count, +8 state count, +0x0C the actor of each
 * track (bytes), +0x10 the states (0x8C bytes each: +4 steps per track, +8 per-track step lists,
 * +0x24 step count, +0x28 steps, +0x2C argument count, +0x30 typed argument values).
 * A step (0x30 bytes): +0 start condition [event, track, step, timeline key] (FF FF FF = at
 * once; event 0 = that step started (a Timeline: reached the key), 4 = finished), +8 its action
 * definition, +0x19 argument count, +0x1A argument slots (FF = default), +0x28 / +0x2C timeline
 * keys (count, 12-byte entries [?, time ms, ?]).
 */
import { CAP_BASE } from './cap.ts';

export interface CapTriggerVolume {
  polygon: [number, number][];
  yMin: number;
  yMax: number;
}

/** A flag (0x14) or quest (0x1D) trigger, keyed by its object offset in the act. */
export interface CapStoryTrigger {
  id: number;
  kind: 'flag' | 'quest' | 'relay';
  /** Activation word (+8): bit 0 = fires when the player walks into the volume. */
  activation: number;
  volume?: CapTriggerVolume;
  /** Quest triggers: quest index, main story or side quest, action mask, player bit. */
  quest?: { index: number; main: boolean; actions: number; bit: number };
  /** Relays: what firing it fires. */
  targets?: CapRef[];
  /**
   * Relays: the brush it sets moving (the mover's use, as a lever's): the runtime object pointed
   * to just before the relay's record (Ws9a 159982 -> bCellDoor, 159370 -> bOuterGates).
   */
  brushes?: string[];
}

/** A camera path (types 0x53 / 0x55): piecewise cubic Bezier, progress advanced per millisecond. */
export interface CapCameraPath {
  points: [number, number, number][];
  segments: number;
  /** Progress per millisecond (1 / duration). */
  rate: number;
  flags: number;
}

export interface CapCamera {
  id: number;
  eye: CapCameraPath;
  target: CapCameraPath;
}

/** A step's start condition: `null` = at once. */
export interface CapStepWhen {
  /** 0 = when that step starts (a Timeline: reaches `key`), 4 = when it finishes; other values raw. */
  event: number;
  track: number;
  step: number;
  key: number;
}

/** A reference argument, resolved to what it names in the act. */
export type CapRef =
  | { player: 'player' | 'actor' }
  | { creature: number }
  | { trigger: number }
  | { camera: number }
  | { exit: string; exitNumber: number }
  | { sequence: string }
  | { object: number };

export type CapArg = number | [number, number, number] | CapRef;

export interface CapStep {
  action: string;
  when: CapStepWhen | null;
  args: Record<string, CapArg>;
  /** Timeline steps: key times (ms). */
  keys?: number[];
}

export interface CapSequence {
  name: string;
  /** The flag trigger that starts it. */
  trigger: number;
  camera?: number;
  /** Actor 2 + i: `actors[i]` ('player' = the stand-in for Drake). */
  actors: ({ player: true } | { creature: number } | null)[];
  /** Tracks in order; `actor` is the actor index (2 = the first entry of `actors`). */
  tracks: { actor: number; steps: number[] }[];
  steps: CapStep[];
}

/** A message trigger (type 0x1A): signs read with the use key, hints shown on walking in. */
export interface CapMessage {
  id: number;
  /** Activation word (+8): bit 0 walked into, bit 3 use key, 0x200 fires once. */
  activation: number;
  volume?: CapTriggerVolume;
  /** Index in script/messages.ctx. */
  message: number;
}

export interface CapStory {
  triggers: CapStoryTrigger[];
  messages: CapMessage[];
  cameras: CapCamera[];
  sequences: CapSequence[];
}

/** Context from the rest of the act: creature records and exit records by offset. */
export interface StoryContext {
  /** Creature record offset (class 0x2D) -> creature index. */
  creatureAt: ReadonlyMap<number, number>;
  /** Exit record offset (the portal record) -> its destination and number. */
  exitAt: ReadonlyMap<number, { target: string; exit: number }>;
  parseVolume(at: number): CapTriggerVolume | null;
}

const T_EXIT = 0x13;
const T_FLAG = 0x14;
const T_MESSAGE = 0x1a;
const T_QUEST = 0x1d;
const T_CAMERA = 0x28;
const T_RELAY = 0x2b;
const T_ACTION = 0x40;
const T_BINDING = 0x4d;
const TYPE_COUNT = 0xe1;
/** Creature objects start 0x18 before their class-0x2D record (vtable patched in at load). */
const CREATURE_OBJECT_OFFSET = 0x18;

/** The cap DB's per-type object table: type -> object offsets. */
export function capTypeTable(data: Uint8Array, dv: DataView, size: number, tableBytes: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let p = size - tableBytes;
  if (p < 0 || p >= data.length) return out;
  for (let t = 0; t < TYPE_COUNT && p + 4 <= data.length; t++) {
    const n = dv.getUint32(p, true);
    p += 4;
    if (n > 100000 || p + 4 * n > data.length) return new Map();
    const list: number[] = [];
    for (let i = 0; i < n; i++) list.push(dv.getUint32(p + 4 * i, true) - CAP_BASE);
    p += 4 * n;
    if (list.length) out.set(t, list);
  }
  return out;
}

const ascii = (data: Uint8Array, o: number, max = 64): string => {
  let e = o;
  while (e < data.length && e - o < max && data[e]! >= 0x20 && data[e]! < 0x7f) e++;
  return new TextDecoder('latin1').decode(data.subarray(o, e));
};

export function parseStory(data: Uint8Array, dv: DataView, types: ReadonlyMap<number, number[]>, ctx: StoryContext): CapStory {
  const inRange = (o: number, n = 4) => o >= 0 && o + n <= data.length;
  const ptr = (o: number) => dv.getUint32(o, true) - CAP_BASE;
  const f32 = (o: number) => Math.round(dv.getFloat32(o, true) * 1000) / 1000;
  const is = (o: number, t: number) => types.get(t)?.includes(o) ?? false;

  // --- Triggers
  const triggers: CapStoryTrigger[] = [];
  for (const [kind, t] of [['flag', T_FLAG], ['quest', T_QUEST]] as const) {
    for (const o of types.get(t) ?? []) {
      if (!inRange(o, 0x40)) continue;
      const vol = ptr(o + 4);
      const volume = vol > 0 && inRange(vol, 0x40) ? ctx.parseVolume(vol) : null;
      const trig: CapStoryTrigger = { id: o, kind, activation: dv.getUint32(o + 8, true), ...(volume ? { volume } : {}) };
      if (kind === 'quest') {
        const actions = data[o + 0x0e]!;
        trig.quest = { index: dv.getInt16(o + 0x34, true), main: (actions & 0x80) !== 0, actions: actions & 0x7f, bit: dv.getInt16(o + 0x36, true) };
      }
      triggers.push(trig);
    }
  }

  const messages: CapMessage[] = [];
  for (const o of types.get(T_MESSAGE) ?? []) {
    if (!inRange(o, 0x38)) continue;
    const vol = ptr(o + 4);
    const volume = vol > 0 && inRange(vol, 0x40) ? ctx.parseVolume(vol) : null;
    messages.push({ id: o, activation: dv.getUint32(o + 8, true), ...(volume ? { volume } : {}), message: dv.getInt32(o + 0x34, true) });
  }

  // --- Cameras
  const path =(o: number): CapCameraPath | null => {
    if (!inRange(o, 0x40)) return null;
    const n = data[o + 0x10]!;
    const segments = data[o + 0x11]!;
    const pts = ptr(o + 4);
    if (n < 2 || n > 64 || segments < 1 || !inRange(pts, 12 * n)) return null;
    const points: [number, number, number][] = [];
    for (let i = 0; i < n; i++) points.push([f32(pts + 12 * i), f32(pts + 12 * i + 4), f32(pts + 12 * i + 8)]);
    if (!points.flat().every((v) => Number.isFinite(v) && Math.abs(v) < 1e5)) return null;
    return { points, segments, rate: dv.getFloat32(o + 8, true), flags: data[o + 0x13]! };
  };
  const cameras: CapCamera[] = [];
  for (const o of types.get(T_CAMERA) ?? []) {
    if (!inRange(o, 0x3c)) continue;
    const eye = path(ptr(o + 0x34));
    const target = path(ptr(o + 0x38));
    if (eye && target) cameras.push({ id: o, eye, target });
  }
  const cameraIds = new Set(cameras.map((c) => c.id));

  // --- Action definitions: offset -> name and argument names
  const actions = new Map<number, { name: string; args: string[] }>();
  for (const o of types.get(T_ACTION) ?? []) {
    if (!inRange(o, 0x40)) continue;
    const nargs = data[o + 7]!;
    const argp = ptr(o + 0x3c);
    const args: string[] = [];
    for (let i = 0; i < nargs && inRange(argp + 0x33 * i, 0x33); i++) args.push(ascii(data, argp + 0x33 * i).replace(/^arg_/, ''));
    actions.set(o, { name: ascii(data, o + 8), args });
  }

  // --- Sequences, through their bindings
  const bindings = types.get(T_BINDING) ?? [];
  const seqName = new Map<number, string>(); // definition offset -> name
  for (const b of bindings) {
    if (!inRange(b, 0x30)) continue;
    const def = ptr(b + 0x20);
    if (inRange(def, 0x40)) seqName.set(b, ascii(data, def + 0x14).replace(/^EntGrpScriptedSequence/, '') || `Seq${seqName.size}`);
  }

  const resolveRef = (value: number): CapRef => {
    if (value === 0) return { player: 'player' };
    if (value === 1) return { player: 'actor' };
    const o = value - CAP_BASE;
    const creature = ctx.creatureAt.get(o + CREATURE_OBJECT_OFFSET);
    if (creature !== undefined) return { creature };
    if (is(o, T_FLAG) || is(o, T_QUEST) || is(o, T_RELAY)) return { trigger: o };
    if (cameraIds.has(o)) return { camera: o };
    if (is(o, T_EXIT) && inRange(o, 0x38)) {
      const exit = ctx.exitAt.get(o + 0x34);
      if (exit) return { exit: exit.target, exitNumber: exit.exit };
    }
    if (seqName.has(o)) return { sequence: seqName.get(o)! };
    return { object: o };
  };

  for (const o of types.get(T_RELAY) ?? []) {
    if (!inRange(o, 0x3c)) continue;
    const n = dv.getInt16(o + 0x36, true);
    const list = ptr(o + 0x38);
    const vol = ptr(o + 4);
    const volume = vol > 0 && inRange(vol, 0x40) ? ctx.parseVolume(vol) : null;
    const targets = n > 0 && n < 64 && inRange(list, 4 * n) ? Array.from({ length: n }, (_, i) => resolveRef(dv.getUint32(list + 4 * i, true))) : [];
    // A brush (class 0x31) runtime object starts 0x18 before its record; its name pointer is at record +0x14.
    const owner = o >= 4 ? ptr(o - 4) : -1;
    const namePtr = owner >= 0 && inRange(owner + 0x18 + 0x14, 4) ? ptr(owner + 0x18 + 0x14) : -1;
    const brush = namePtr >= 0 && inRange(namePtr, 1) ? ascii(data, namePtr) : '';
    const brushes = /^b[A-Za-z]\w*$/.test(brush) && dv.getUint32(owner + 0x18, true) === 0x31 ? [brush] : [];
    triggers.push({ id: o, kind: 'relay', activation: dv.getUint32(o + 8, true), ...(volume ? { volume } : {}), targets, ...(brushes.length ? { brushes } : {}) });
  }

  const sequences: CapSequence[] = [];
  for (const b of bindings) {
    if (!inRange(b, 0x40)) continue;
    const def = ptr(b + 0x20);
    if (!inRange(def, 0x20)) continue;
    const trackCount = data[def + 2]!;
    const states = data[def + 8]!;
    const trackActors = ptr(def + 0x0c);
    const S = ptr(def + 0x10);
    if (trackCount < 1 || trackCount > 32 || states < 1 || !inRange(S, 0x8c) || !inRange(trackActors, trackCount)) continue;
    // Only the first state is used by the shipped sequences (state count 1).
    const counts = ptr(S + 4);
    const lists = ptr(S + 8);
    const stepCount = data[S + 0x24]!;
    const stepBase = ptr(S + 0x28);
    const argCount = data[S + 0x2c]!;
    const argBase = ptr(S + 0x30);
    if (!inRange(counts, trackCount) || !inRange(lists, 4 * trackCount) || !inRange(stepBase, 0x30 * stepCount) || !inRange(argBase, 8 * argCount)) continue;
    const values: (CapArg | undefined)[] = [];
    for (let i = 0; i < argCount; i++) {
      const at = argBase + 8 * i;
      const type = dv.getUint32(at, true);
      const raw = dv.getUint32(at + 4, true);
      if (type === 0x0a) values.push(dv.getInt32(at + 4, true));
      else if (type === 0x0b) values.push(f32(at + 4));
      else if (type === 0x1e) {
        const p = raw - CAP_BASE;
        values.push(inRange(p, 12) ? [f32(p), f32(p + 4), f32(p + 8)] : undefined);
      } else values.push(resolveRef(raw));
    }
    const steps: CapStep[] = [];
    for (let k = 0; k < stepCount; k++) {
      const s = stepBase + 0x30 * k;
      const action = actions.get(ptr(s + 8));
      const c = [data[s]!, data[s + 1]!, data[s + 2]!, data[s + 3]!];
      const when = c[1] === 0xff && c[2] === 0xff && c[3] === 0xff ? null : { event: c[0]!, track: c[1]!, step: c[2]!, key: c[3]! };
      const args: Record<string, CapArg> = {};
      const n = data[s + 0x19]!;
      for (let j = 0; j < n && j < 8; j++) {
        const slot = data[s + 0x1a + j]!;
        const v = slot === 0xff ? undefined : values[slot];
        if (v !== undefined) args[action?.args[j] ?? `arg${j}`] = v;
      }
      const step: CapStep = { action: action?.name ?? 'Unknown', when, args };
      if (step.action === 'Timeline') {
        const nk = dv.getUint32(s + 0x28, true);
        const kp = ptr(s + 0x2c);
        if (nk > 0 && nk < 1000 && inRange(kp, 12 * nk)) step.keys = Array.from({ length: nk }, (_, i) => dv.getUint32(kp + 12 * i + 4, true));
      }
      steps.push(step);
    }
    const tracks: CapSequence['tracks'] = [];
    for (let t = 0; t < trackCount; t++) {
      const lp = ptr(lists + 4 * t);
      const n = data[counts + t]!;
      tracks.push({ actor: data[trackActors + t]!, steps: inRange(lp, n) ? [...data.subarray(lp, lp + n)].filter((i) => i < stepCount) : [] });
    }
    // Actor table: [kind u32][value u32] per actor (kind 1: value 1 = the stand-in, else a creature).
    const actorCount = dv.getUint32(b + 0x28, true);
    const table = ptr(b + 0x2c);
    const seqActors: CapSequence['actors'] = [];
    for (let i = 0; i < actorCount && i < 32 && inRange(table + 8 * i, 8); i++) {
      const v = dv.getUint32(table + 8 * i + 4, true);
      if (v === 1) seqActors.push({ player: true });
      else {
        const creature = ctx.creatureAt.get(v - CAP_BASE + CREATURE_OBJECT_OFFSET);
        seqActors.push(creature !== undefined ? { creature } : null);
      }
    }
    const triggerRef = dv.getUint32(b + 0x10, true) === T_FLAG ? ptr(b + 0x14) : -1;
    const camera = ptr(b + 0x18);
    sequences.push({
      name: seqName.get(b) ?? `Seq${sequences.length}`,
      trigger: triggerRef,
      ...(cameraIds.has(camera) ? { camera } : {}),
      actors: seqActors,
      tracks,
      steps,
    });
  }
  return { triggers, messages, cameras, sequences };
}
