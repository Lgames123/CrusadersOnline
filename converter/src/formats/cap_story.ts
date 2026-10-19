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
 *   0x0B  sound trigger (vtable 0x4E1D58): fired (0x461490) it plays Sound.ctx id +0x34 at each
 *         of +0x3E points (list at +0x40, 12 bytes each), volume +0x44 (0x4B13C0)
 *   0x1E  mover trigger (vtable 0x4E1CE0): fired (0x461B10) it uses the mover of the brush whose
 *         runtime object is at +0x38 (record = object + 0x18, name pointer at record + 0x14)
 *   0x2B  relay trigger (vtable 0x4E1E84): touching it (0x463A90) arms a timer of u16 +0x38 ms;
 *         its fire (slot 5, 0x463CC0) runs +0x3C ops of 16 bytes at +0x40: [op u8, ?, +4 pointer
 *         to a second argument [type u8, value +4], arg type u32 +8, value +0x0C]. Arg type 0x14
 *         (an object): op 8 fires its slot 5 directly (a message shows its text, an exit changes
 *         level 0x462890, a mover trigger moves its brush, a sound trigger plays), ops 0 / 1 set /
 *         clear its +0x0D bit 0, 2 / 3 call its slots 6 / 7. Arg type 1 (a creature object; op 8
 *         becomes 0x0A): 0x0A / 0x0B / 0x0C queue brain events 0x18 / 0x17 / 0x19 (0x4102D0;
 *         0x0B and 0x0C name a second creature), 0x0D sets brain +0x14 bit 0x400, 0x0E sets the
 *         creature's disposition to 4 (0x405520, 0x40CCD0)
 *   0x5E  a creature's health (inside its record; +4 the creature object, +8 hit points): when
 *         they run out (0x44CA00) the creature dies and, if +0x1F4 has 0x8000000, the trigger at
 *         +0x1F0 fires (slot 5, the player as activator): Du2a's OgreOutlaw7 -> relay 401805
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
  /** Relays: what firing it fires (op 8 on triggers, messages and exits). */
  targets?: CapRef[];
  /** Relays: ms between being touched and firing (u16 +0x38). */
  delay?: number;
  /** Relays: the brushes it sets moving (op 8 on a mover trigger, 0x461B10: the mover's use). */
  brushes?: string[];
  /** Relays: the sounds it plays (op 8 on a sound trigger, 0x461490). */
  sounds?: CapSound[];
  /** Relays: creature ops 0x0A-0x0E, in order. */
  creatureOps?: CapCreatureOp[];
  /** Relays: ops 0-3 on an object (set / clear its +0x0D bit 0, its slots 6 / 7); no reader decoded. */
  flagOps?: { op: 0 | 1 | 2 | 3; target: CapRef }[];
}

/** A sound trigger's sound (type 0x0B): Sound.ctx id, positions (feet), volume. */
export interface CapSound {
  id: number;
  positions: [number, number, number][];
  volume: number;
}

/**
 * A relay's creature op (0x463CC0; `creature` / `other` are indices in the act's creatures):
 * targetPlayer 0x0A (brain event 0x18: a hostile one takes the player as its target, 0x40D910),
 * preferTarget 0x0B (event 0x17: a hostile one picks `other`), attackTarget 0x0C (event 0x19:
 * an idle one attacks `other` now, 0x40C370), fightNearest 0x0D (brain flag 0x400: it targets the
 * nearest opposing creature or player in sight, at any range, 0x40DC90), disposition4 0x0E.
 */
export interface CapCreatureOp {
  op: 'targetPlayer' | 'preferTarget' | 'attackTarget' | 'fightNearest' | 'disposition4';
  creature: number;
  other?: number;
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
  | { message: number }
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

/** A creature whose death fires a trigger (type 0x5E +0x1F0, flag 0x8000000 at +0x1F4). */
export interface CapDeathTrigger {
  /** Index in the act's creatures. */
  creature: number;
  trigger: number;
}

/**
 * A sound trigger walked into (type 0x0B with activation bit 0 and a volume): the line or sound
 * plays at its points when the player enters (Ci1b's "Celestia is expecting you" by the guards,
 * Drake's remarks, the prisoners' pleas in train). 0x200: once.
 */
export interface CapSoundTrigger {
  id: number;
  activation: number;
  volume: CapTriggerVolume;
  sound: { id: number; positions: [number, number, number][]; volume: number };
}

/**
 * A shop (type 0x1C, vtable 0x4E1D94): the use key in its volume plays the greeting (+0x36,
 * Sound.ctx) and opens the inventory screen in trade mode (fire 0x464170 -> 0x4572E0(2, 5)) with
 * a fresh copy of its items (+0x35 count, +0x38 slots of 0x44 bytes: count +0x10, name +0x24;
 * 0x46D3D0). Each act has its own (the stock changes as the story goes on).
 */
export interface CapShop {
  id: number;
  activation: number;
  volume: CapTriggerVolume;
  greeting: number;
  stock: { name: string; quantity: number }[];
}

export interface CapStory {
  triggers: CapStoryTrigger[];
  messages: CapMessage[];
  soundTriggers: CapSoundTrigger[];
  shops: CapShop[];
  deaths: CapDeathTrigger[];
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

const T_SOUND = 0x0b;
const T_EXIT = 0x13;
const T_FLAG = 0x14;
const T_MESSAGE = 0x1a;
const T_SHOP = 0x1c;
const T_QUEST = 0x1d;
const T_MOVER = 0x1e;
const T_CAMERA = 0x28;
const T_RELAY = 0x2b;
const T_ACTION = 0x40;
const T_HEALTH = 0x5e;
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
  /** A sound trigger's sound (0x461490): Sound.ctx id +0x34, point count +0x3E, points +0x40, volume +0x44. */
  const soundAt = (at: number) => {
    const count = dv.getUint16(at + 0x3e, true);
    const pts = ptr(at + 0x40);
    const positions: [number, number, number][] = [];
    for (let k = 0; k < count && k < 16 && inRange(pts + 12 * k, 12); k++) positions.push([f32(pts + 12 * k), f32(pts + 12 * k + 4), f32(pts + 12 * k + 8)]);
    return { id: dv.getInt16(at + 0x34, true), positions, volume: f32(at + 0x44) };
  };

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

  // --- Sound triggers walked into (relay-fired ones are read with their relays).
  const soundTriggers: CapSoundTrigger[] = [];
  for (const o of types.get(T_SOUND) ?? []) {
    if (!inRange(o, 0x48)) continue;
    const activation = dv.getUint32(o + 8, true);
    const vol = ptr(o + 4);
    const volume = activation & 1 && vol > 0 && inRange(vol, 0x40) ? ctx.parseVolume(vol) : null;
    if (!volume) continue;
    const sound = soundAt(o);
    if (sound.id >= 0) soundTriggers.push({ id: o, activation, volume, sound });
  }

  // --- Shops (type 0x1C)
  const shops: CapShop[] = [];
  for (const o of types.get(T_SHOP) ?? []) {
    if (!inRange(o, 0x3c)) continue;
    const vol = ptr(o + 4);
    const volume = vol > 0 && inRange(vol, 0x40) ? ctx.parseVolume(vol) : null;
    if (!volume) continue;
    const n = data[o + 0x35]!;
    const slots = ptr(o + 0x38);
    const stock: CapShop['stock'] = [];
    for (let i = 0; i < n && inRange(slots + 0x44 * i, 0x44); i++) {
      const name = ascii(data, slots + 0x44 * i + 0x24, 0x20).trim();
      if (name) stock.push({ name, quantity: Math.max(1, dv.getInt32(slots + 0x44 * i + 0x10, true)) });
    }
    shops.push({ id: o, activation: dv.getUint32(o + 8, true), volume, greeting: dv.getInt16(o + 0x36, true), stock });
  }

  // --- Cameras
  const path = (o: number): CapCameraPath | null => {
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
    if (is(o, T_MESSAGE)) return { message: o };
    if (cameraIds.has(o)) return { camera: o };
    if (is(o, T_EXIT) && inRange(o, 0x38)) {
      const exit = ctx.exitAt.get(o + 0x34);
      if (exit) return { exit: exit.target, exitNumber: exit.exit };
    }
    if (seqName.has(o)) return { sequence: seqName.get(o)! };
    return { object: o };
  };

  /** A brush's name from its runtime object (record = object + 0x18: class 0x31, name pointer at +0x14). */
  const brushName = (obj: number): string => {
    const rec = obj + 0x18;
    if (!inRange(rec + 0x14, 4) || dv.getUint32(rec, true) !== 0x31) return '';
    const name = ptr(rec + 0x14);
    return inRange(name, 1) ? ascii(data, name) : '';
  };
  const creatureOf = (value: number): number | undefined => (value ? ctx.creatureAt.get(value - CAP_BASE + CREATURE_OBJECT_OFFSET) : undefined);
  const CREATURE_OPS = { 0x0a: 'targetPlayer', 0x0b: 'preferTarget', 0x0c: 'attackTarget', 0x0d: 'fightNearest', 0x0e: 'disposition4' } as const;
  for (const o of types.get(T_RELAY) ?? []) {
    if (!inRange(o, 0x44)) continue;
    const n = dv.getInt32(o + 0x3c, true);
    const list = ptr(o + 0x40);
    const vol = ptr(o + 4);
    const volume = vol > 0 && inRange(vol, 0x40) ? ctx.parseVolume(vol) : null;
    const targets: CapRef[] = [];
    const brushes: string[] = [];
    const sounds: CapSound[] = [];
    const creatureOps: CapCreatureOp[] = [];
    const flagOps: { op: 0 | 1 | 2 | 3; target: CapRef }[] = [];
    for (let i = 0; n > 0 && n < 64 && i < n && inRange(list + 16 * i, 16); i++) {
      const e = list + 16 * i;
      const argType = dv.getUint32(e + 8, true);
      const value = dv.getUint32(e + 12, true);
      const op = data[e] === 8 && argType === 1 ? 0x0a : data[e]!;
      if (argType === T_FLAG && value) {
        // An object (arg type 0x14 names any trigger-like object, not only flag triggers).
        const at = value - CAP_BASE;
        if (op === 8 && is(at, T_MOVER) && inRange(at, 0x3c)) {
          const name = brushName(ptr(at + 0x38));
          if (name) brushes.push(name);
        } else if (op === 8 && is(at, T_SOUND) && inRange(at, 0x48)) {
          sounds.push(soundAt(at));
        } else if (op === 8) targets.push(resolveRef(value));
        else if (op <= 3) flagOps.push({ op: op as 0 | 1 | 2 | 3, target: resolveRef(value) });
      } else if (argType === 1 && op in CREATURE_OPS) {
        const creature = creatureOf(value);
        if (creature === undefined) continue;
        const entry: CapCreatureOp = { op: CREATURE_OPS[op as keyof typeof CREATURE_OPS], creature };
        // 0x0B / 0x0C act only when their second argument is a creature [type 1, object].
        if (op === 0x0b || op === 0x0c) {
          const sub = dv.getUint32(e + 4, true) - CAP_BASE;
          const other = inRange(sub, 8) && data[sub] === 1 ? creatureOf(dv.getUint32(sub + 4, true)) : undefined;
          if (other === undefined) continue;
          entry.other = other;
        }
        creatureOps.push(entry);
      }
    }
    const delay = dv.getUint16(o + 0x38, true);
    triggers.push({
      id: o,
      kind: 'relay',
      activation: dv.getUint32(o + 8, true),
      ...(volume ? { volume } : {}),
      targets,
      ...(delay ? { delay } : {}),
      ...(brushes.length ? { brushes } : {}),
      ...(sounds.length ? { sounds } : {}),
      ...(creatureOps.length ? { creatureOps } : {}),
      ...(flagOps.length ? { flagOps } : {}),
    });
  }

  // --- Use-key mover triggers no relay fires (Ca*a's lever and its five bPlat rings, Ca*c's
  // bTortTop1): the use key in their volume fires them directly (0x460320 -> slot 5, 0x461B10),
  // written as one-op relays. Use-key sound triggers sharing such a volume play with them (Ca*a's
  // 519). Doors and gates are left out: their own use opens them and plays their sounds.
  const relayed = new Set<number>();
  for (const r of types.get(T_RELAY) ?? []) {
    const n = dv.getInt32(r + 0x3c, true);
    const list = ptr(r + 0x40);
    for (let i = 0; n > 0 && n < 64 && i < n && inRange(list + 16 * i, 16); i++) relayed.add(ptr(list + 16 * i + 12));
  }
  const useVolumes = new Set<number>();
  const useTrigger = (o: number, extra: Pick<CapStoryTrigger, 'brushes' | 'sounds'>) => {
    const volume = ctx.parseVolume(ptr(o + 4));
    if (volume) triggers.push({ id: o, kind: 'relay', activation: dv.getUint32(o + 8, true), volume, targets: [], ...extra });
    return !!volume;
  };
  for (const o of types.get(T_MOVER) ?? []) {
    if (!inRange(o, 0x3c) || relayed.has(o) || !inRange(ptr(o + 4), 0x40)) continue;
    const activation = dv.getUint32(o + 8, true);
    const name = brushName(ptr(o + 0x38));
    if (!name || /door|gate/i.test(name)) continue;
    if (activation & 8) {
      if (useTrigger(o, { brushes: [name] })) useVolumes.add(ptr(o + 4));
    } else if (activation & 1 && /bridge/i.test(name)) {
      // Walked into (Ca*b's swinging bridges bBridgePiece4/5, activation 1): the same one-op relay.
      // Other walk-in movers (wheels, crushers, chandeliers, gears) are left at rest.
      useTrigger(o, { brushes: [name] });
    }
  }
  for (const o of types.get(T_SOUND) ?? []) {
    if (!inRange(o, 0x48) || relayed.has(o) || !(dv.getUint32(o + 8, true) & 8) || !useVolumes.has(ptr(o + 4))) continue;
    const sound = soundAt(o);
    if (sound.id >= 0) useTrigger(o, { sounds: [sound] });
  }

  // --- Death triggers: a creature's health object (inside its record) names the trigger its death fires.
  const deaths: CapDeathTrigger[] = [];
  for (const o of types.get(T_HEALTH) ?? []) {
    if (!inRange(o, 0x1f8) || !(dv.getUint32(o + 0x1f4, true) & 0x8000000)) continue;
    const creature = ctx.creatureAt.get(ptr(o + 4) + CREATURE_OBJECT_OFFSET);
    const trigger = ptr(o + 0x1f0);
    if (creature !== undefined && trigger > 0) deaths.push({ creature, trigger });
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
  return { triggers, messages, soundTriggers, shops, deaths, cameras, sequences };
}
