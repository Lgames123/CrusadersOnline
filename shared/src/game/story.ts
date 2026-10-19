/**
 * The original's story layer (asset-format-discovery.md §6.5, executable-analysis.md §17):
 * triggers, scripted sequences (cutscenes) with their cameras, and the quest manager.
 *
 * Level data comes from the converter (`story` in levels/<act>.placements.json, original units
 * with Z mirrored); quest text from rules/strings.json (crusaders.exe's string table). Only
 * numbers and identifiers live here.
 */

/** The ASM state ids the sequences ask for (exe table 0x4EA6F0, id / name pairs). */
export const ASM_STATE_NAMES: Readonly<Record<number, string>> = {
  1: 'ASM_RUNNING', 2: 'ASM_WALKING', 3: 'ASM_TURN_L', 4: 'ASM_TURN_R', 5: 'ASM_SIDE_STEP_L', 6: 'ASM_SIDE_STEP_R', 7: 'ASM_STANDING',
  8: 'ASM_STANDING_JUMP_V', 9: 'ASM_STANDING_JUMP_F', 10: 'ASM_RUNNING_JUMP_F', 11: 'ASM_STANDING_JUMP_L', 12: 'ASM_STANDING_JUMP_R',
  13: 'ASM_ROLL_F', 14: 'ASM_ROLL_L', 15: 'ASM_ROLL_R', 16: 'ASM_ROLL_B', 17: 'ASM_LAND_SOFT', 19: 'ASM_RETREAT', 20: 'ASM_STANDING_JUMP_B',
  21: 'ASM_FALL_SHORT', 22: 'ASM_FALL_LONG', 23: 'ASM_CHOP_LOW', 24: 'ASM_SWING_LEVEL', 25: 'ASM_SWING_OVERHEAD', 26: 'ASM_PUSH_PLATE',
  27: 'ASM_LAND_SOFT_QUICK', 28: 'ASM_READY_WEAPON', 29: 'ASM_BLOCK', 30: 'ASM_RAM_SHOULDER', 34: 'ASM_CLIMB_UP', 35: 'ASM_CLIMB_DOWN',
  36: 'ASM_CLIMB_LEFT', 37: 'ASM_CLIMB_RIGHT', 38: 'ASM_CLIMB_REVERSE_JUMP', 39: 'ASM_CLIMB_TRANSITION', 40: 'ASM_CLIMB_TRANSITION_B',
  41: 'ASM_HANG_TO_CLIMB', 42: 'ASM_CROUCHING', 43: 'ASM_HOP_F', 44: 'ASM_HOP_B', 45: 'ASM_HOP_L', 46: 'ASM_HOP_R',
  47: 'ASM_SPELL_TORCH_LIGHT', 48: 'ASM_SPELL_FIRE_BALL', 49: 'ASM_SPELL_SLOW', 50: 'ASM_SPELL_FANTASTIC_FREEZE', 51: 'ASM_SPELL_STONE_SKIN',
  52: 'ASM_SPELL_LIGHTNING', 53: 'ASM_SPELL_HEROISM', 54: 'ASM_SPELL_SPECTRAL_ALLY', 55: 'ASM_SPELL_HOLY_WRATH', 56: 'ASM_SPELL_SOUL_DRINKER',
  57: 'ASM_SPELL_CONJURE', 58: 'ASM_READY_SHIELD', 59: 'ASM_HANG', 60: 'ASM_CLIMB_TO_HANG', 61: 'ASM_HANG_MOUNT', 62: 'ASM_LOW_MOUNT',
  63: 'ASM_HIGH_MOUNT', 64: 'ASM_IMPACT_FRONT', 65: 'ASM_IMPACT_LEFT', 66: 'ASM_IMPACT_RIGHT', 67: 'ASM_IMPACT_BACK', 68: 'ASM_COMBAT_STANDING',
  69: 'ASM_COMBAT_TURN_L', 70: 'ASM_COMBAT_TURN_R', 71: 'ASM_COMBAT_SIDE_STEP_L', 72: 'ASM_COMBAT_SIDE_STEP_R', 73: 'ASM_ATTACK_LOW2',
  74: 'ASM_ATTACK_LEVEL2', 75: 'ASM_ATTACK_HIGH2', 76: 'ASM_THROW_ITEM', 77: 'ASM_IMPACT_SEVERE', 78: 'ASM_HIT_POINTS_DEPLETED',
  79: 'ASM_SLIDE_F', 80: 'ASM_SLIDE_TRANSITION', 81: 'ASM_GESTURE_POLITE_CONVERSATION', 82: 'ASM_GESTURE_TELL_STORY',
  83: 'ASM_GESTURE_SERIOUS', 84: 'ASM_GESTURE_ANGRY', 85: 'ASM_GESTURE_BORING', 86: 'ASM_GESTURE_APPEASE', 89: 'ASM_THRUST',
  90: 'ASM_JUMP_ATTACK', 91: 'ASM_IMPACT_MEDIUM', 92: 'ASM_GESTURE_WAVE', 93: 'ASM_GESTURE_LAUGH', 94: 'ASM_GESTURE_JOKE',
  95: 'ASM_GESTURE_LISTEN', 96: 'ASM_GESTURE_MISC_01', 97: 'ASM_GESTURE_MISC_02', 98: 'ASM_GESTURE_MISC_03', 99: 'ASM_GESTURE_MISC_04',
  100: 'ASM_GESTURE_MISC_05', 101: 'ASM_READY_THROW_WEAPON', 111: 'ASM_HIT_POINTS_DEPLETED_ALT_01', 112: 'ASM_HIT_POINTS_DEPLETED_ALT_02',
  114: 'ASM_HIT_POINTS_DEPLETED_ALT_04', 115: 'ASM_HIT_POINTS_DEPLETED_ALT_05', 116: 'ASM_HIT_POINTS_DEPLETED_ALT_06',
  117: 'ASM_HIT_POINTS_DEPLETED_ALT_07', 118: 'ASM_HIT_POINTS_DEPLETED_ALT_08', 119: 'ASM_IMPACT_RIGHT_FRONT',
  120: 'ASM_IMPACT_FRONT_TWO_STEPS_BACK', 121: 'ASM_IMPACT_FRONT_ALT_01', 122: 'ASM_IMPACT_LEFT_ALT_01', 123: 'ASM_IMPACT_LOW_FRONT',
  124: 'ASM_STANDING_ALT_01', 125: 'ASM_STANDING_ALT_02', 126: 'ASM_STANDING_ALT_03', 127: 'ASM_STANDING_ALT_04', 128: 'ASM_STANDING_ALT_05',
};

// ---------------------------------------------------------------------------------------------
// Level data (converter output)

/** A trigger volume: an x/z polygon between two heights (original units, Z mirrored). */
export interface StoryVolume {
  polygon: [number, number][];
  yMin: number;
  yMax: number;
}

/** A reference argument, resolved by the converter. */
export type StoryRef =
  | { player: 'player' | 'actor' }
  | { creature: number }
  | { trigger: number }
  | { camera: number }
  | { exit: string; exitNumber: number }
  | { sequence: string }
  /** A message trigger (LevelStory.messages): firing it shows its text. */
  | { message: number }
  | { object: number };

export type StoryArg = number | [number, number, number] | StoryRef;

export interface StoryQuestAction {
  index: number;
  /** Main story quest (else a side quest). */
  main: boolean;
  /** Action mask (trigger +0x0E without the main bit): QUEST_ACTION. */
  actions: number;
  bit: number;
}

export interface StoryTrigger {
  /** The trigger's object offset in its act (unique within the act). */
  id: number;
  kind: 'flag' | 'quest' | 'relay';
  /** Bit 0: fires when the player walks into its volume. */
  activation: number;
  volume?: StoryVolume;
  quest?: StoryQuestAction;
  targets?: StoryRef[];
  /** Relays: ms between being touched and firing (0x463A90); a fire from a script or a death is at once. */
  delay?: number;
  /** Relays: the brushes (by name) they set moving (op 8 on a mover trigger, 0x461B10). */
  brushes?: string[];
  /** Relays: the sounds they play (op 8 on a sound trigger, 0x461490). */
  sounds?: StorySound[];
  /** Relays: what they tell creatures (ops 0x0A-0x0E), in order. */
  creatureOps?: StoryCreatureOp[];
  /** Relays: ops 0-3 (set / clear the target's +0x0D bit 0, its slots 6 / 7): kept as data, no reader decoded. */
  flagOps?: { op: 0 | 1 | 2 | 3; target: StoryRef }[];
}

/** A sound a relay plays: Sound.ctx id at each position (feet, converted frame), volume 0..1. */
export interface StorySound {
  id: number;
  positions: [number, number, number][];
  volume: number;
}

/**
 * A relay's creature op (`creature` / `other`: indices in the act's creatures). targetPlayer
 * (0x0A, brain event 0x18): a hostile creature takes the player as its target at once (0x40D910).
 * preferTarget (0x0B, event 0x17): a hostile one picks `other`. attackTarget (0x0C, event 0x19):
 * an idle one attacks `other` now (0x40C370). fightNearest (0x0D, brain flag 0x400): it targets
 * the nearest opposing creature or player in sight, at any range (0x40DC90). disposition4 (0x0E):
 * its disposition becomes 4 (0x40CCD0; meaning not decoded).
 */
export interface StoryCreatureOp {
  op: 'targetPlayer' | 'preferTarget' | 'attackTarget' | 'fightNearest' | 'disposition4';
  creature: number;
  other?: number;
}

export interface StoryCameraPath {
  points: [number, number, number][];
  segments: number;
  /** Progress per millisecond. */
  rate: number;
  flags: number;
}

export interface StoryCamera {
  id: number;
  eye: StoryCameraPath;
  target: StoryCameraPath;
}

/** When a step starts: null = at once; event 0 = that step started (a Timeline: reached `key`), 4 = finished. */
export interface StoryWhen {
  event: number;
  track: number;
  step: number;
  key: number;
}

export interface StoryStep {
  action: string;
  when: StoryWhen | null;
  args: Record<string, StoryArg>;
  /** Timeline steps: key times, ms. */
  keys?: number[];
}

export interface StorySequence {
  name: string;
  /** The flag trigger that starts it. */
  trigger: number;
  /** The camera it is filmed with until a CameraTimeline step switches. */
  camera?: number;
  /** Actor 2 + i: the stand-in for Drake, or a placed creature (index in the act's creatures). */
  actors: ({ player: true } | { creature: number } | null)[];
  tracks: { actor: number; steps: number[] }[];
  steps: StoryStep[];
}

/**
 * A message trigger (cap type 0x1A, fired by 0x4632B0): signs read with the use key and hints
 * shown on walking in; the text is shown on the HUD for MESSAGE_MS.
 */
export interface StoryMessage {
  id: number;
  /** Bit 0: walked into; bit 3: use key; 0x200: fires once. */
  activation: number;
  volume?: StoryVolume;
  /** script/messages.ctx index and text. */
  message: number;
  text: string;
}

export const MESSAGE_MS = 2000;

/** A creature whose death fires a trigger for its killer (0x44CA00: health +0x1F0). */
export interface StoryDeath {
  /** Index in the act's creatures. */
  creature: number;
  trigger: number;
}

/**
 * A sound trigger walked into (cap type 0x0B, activation bit 0): its sound plays at its points
 * when the player enters (Ci1b's guard: "Celestia is expecting you"). 0x200: once.
 */
export interface StorySoundTrigger {
  id: number;
  activation: number;
  volume: StoryVolume;
  sound: StorySound;
}

/**
 * A shop (cap type 0x1C): the use key in its volume plays `greeting` and opens the inventory
 * screen in trade mode with a fresh copy of `stock` (items.ctx names), executable-analysis §19.
 */
export interface StoryShop {
  id: number;
  /** Bit 3: the use key (every shipped shop). */
  activation: number;
  volume: StoryVolume;
  /** Sound.ctx id of the merchant's line ("Please, please check out my fine wares."). */
  greeting: number;
  stock: { name: string; quantity: number }[];
}

export interface LevelStory {
  triggers: StoryTrigger[];
  /** Absent in levels converted before shops were read (1.25). */
  shops?: StoryShop[];
  /** Absent in levels converted before walk-in sound triggers were read (1.24). */
  soundTriggers?: StorySoundTrigger[];
  /** Absent in levels converted before message triggers were read. */
  messages?: StoryMessage[];
  /** Absent in levels converted before death triggers were read. */
  deaths?: StoryDeath[];
  cameras: StoryCamera[];
  sequences: StorySequence[];
}

/** First actor index of a sequence (0 = the player, 1 = the stand-in, as step references use them). */
export const SEQUENCE_ACTOR_BASE = 2;

/**
 * A use-key relay without the once bit (0x200) that only moves brushes and plays sounds (Ca*a's
 * lever and floor rings, Ws1a/9a's gate levers): it fires on every press, as the original; the
 * movers' own state keeps a done ring still. Not a story step, so no per-character flag: one saved
 * would leave the floor shut for that character once the zone restarts. A walk-in one that only
 * moves brushes (Ca*b's swinging bridges) likewise fires on every touch: a moving mover ignores it.
 */
export function worldTrigger(t: StoryTrigger): boolean {
  if (t.kind !== 'relay' || t.delay || t.targets?.length || t.creatureOps?.length) return false;
  if ((t.activation & 0x209) === 8) return !!(t.brushes?.length || t.sounds?.length);
  return (t.activation & 0x209) === 1 && !!t.brushes?.length && !t.sounds?.length;
}

/** Whether a point (original units, Z mirrored) is inside a story volume. */
export function inStoryVolume(v: StoryVolume, x: number, y: number, z: number): boolean {
  if (y < v.yMin - 1.5 || y > v.yMax) return false;
  let inside = false;
  const p = v.polygon;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]!;
    const [xj, zj] = p[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------
// Cameras

/** Camera path progress stops just short of the end (0x4DE6BC). */
export const CAMERA_PROGRESS_END = 0.9999;

/**
 * A point of a camera path at `progress` (0..1), as the original evaluates it (0x42DA10): the
 * path is `segments` cubic Bezier pieces over control points P (2 x segments + 2 of them);
 * piece i runs from mid(P[2i], P[2i+1]) (P0 for the first) through P[2i+1] and P[2i+2] to
 * mid(P[2i+2], P[2i+3]) (the last point for the last piece).
 */
export function cameraPathPoint(path: StoryCameraPath, progress: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const P = path.points;
  const n = Math.max(1, path.segments);
  let t = Math.max(0, Math.min(CAMERA_PROGRESS_END, progress)) * n;
  const i = Math.min(n - 1, Math.floor(t));
  t -= i;
  const at = (k: number) => P[Math.min(P.length - 1, Math.max(0, k))]!;
  const mid = (a: readonly number[], b: readonly number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2];
  const b0 = i === 0 ? at(0) : mid(at(2 * i), at(2 * i + 1));
  const b1 = at(2 * i + 1);
  const b2 = at(2 * i + 2);
  const b3 = i === n - 1 ? at(P.length - 1) : mid(at(2 * i + 2), at(2 * i + 3));
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  for (let k = 0; k < 3; k++) out[k] = b0[k]! * w0 + b1[k]! * w1 + b2[k]! * w2 + b3[k]! * w3;
  return out;
}

/** How long a camera's eye path takes, ms (its progress rate is per millisecond). */
export function cameraDurationMs(c: StoryCamera): number {
  return c.eye.rate > 0 ? 1 / c.eye.rate : 0;
}

// ---------------------------------------------------------------------------------------------
// Quests

/** Quest trigger actions (+0x0E; fired by 0x4641F0). */
export const QUEST_ACTION = {
  /** Add the quest's opening journal entry. */
  JOURNAL_START: 0x01,
  /** A side quest's item check (0x4974A0). */
  ITEM_CHECK: 0x02,
  /** Talk to the quest's giver (side quests; a no-op for the main story). */
  TALK: 0x04,
  ASSIGN: 0x08,
  COMPLETE: 0x10,
  /** Add the quest's closing journal entry. */
  JOURNAL_END: 0x20,
  /** Set the player bit (+0x36). */
  PLAYER_BIT: 0x40,
} as const;

/** Main quest states (record +0x32 low bits). */
export const QUEST_STATE = { NONE: 0, ACTIVE: 1, READY: 2, DONE: 3 } as const;

/** Quest book strings (crusaders.exe string table). */
export const QUEST_TEXT = {
  QUEST: 3097,
  SAID: 3098,
  COMPLETED: 3099,
} as const;

/**
 * The main quests (table built by 0x497670, 0x3C bytes each): title, objective and giver
 * (string ids), the reward (Stats_AddExperience; gold), and the journal entries added when it
 * starts and when it ends (string ids; -1 = none).
 */
export interface MainQuest {
  title: number;
  objective: number;
  /** Giver's name (string id), 0 = none. */
  giver: number;
  xp: number;
  gold: number;
  journalStart: number;
  journalEnd: number;
}

export const MAIN_QUESTS: readonly MainQuest[] = [
  { title: 3100, objective: 3110, giver: 3121, xp: 500, gold: 1000, journalStart: 3151, journalEnd: -1 },
  { title: 3101, objective: 3111, giver: 3120, xp: 700, gold: 0, journalStart: 3152, journalEnd: -1 },
  { title: 3102, objective: 3112, giver: 3123, xp: 300, gold: 0, journalStart: 3153, journalEnd: -1 },
  { title: 3103, objective: 3113, giver: 3122, xp: 300, gold: 0, journalStart: 3154, journalEnd: 3165 },
  { title: 3104, objective: 3114, giver: 3120, xp: 300, gold: 0, journalStart: 3155, journalEnd: -1 },
  { title: 3105, objective: 3115, giver: 3121, xp: 100, gold: 0, journalStart: 3156, journalEnd: 3162 },
  { title: 3106, objective: 3116, giver: 0, xp: 250, gold: 0, journalStart: 3157, journalEnd: 3164 },
  { title: 3107, objective: 3117, giver: 3125, xp: 150, gold: 0, journalStart: 3158, journalEnd: 3163 },
  { title: 3108, objective: 3118, giver: 3124, xp: 100, gold: 0, journalStart: 3159, journalEnd: -1 },
  { title: 3109, objective: 3119, giver: 3120, xp: 0, gold: 0, journalStart: 3160, journalEnd: -1 },
];

/** A character's quest book (the quest manager's lists). */
export interface QuestLog {
  /** State per main quest (QUEST_STATE). */
  main: number[];
  /** Assigned quests, in the order given. */
  active: number[];
  /** Completed quests, in the order done. */
  completed: number[];
  /** Journal entries (string ids), in order. */
  journal: number[];
}

export function emptyQuestLog(): QuestLog {
  return { main: MAIN_QUESTS.map(() => QUEST_STATE.NONE), active: [], completed: [], journal: [] };
}

export function sanitizeQuestLog(v: unknown): QuestLog {
  const log = emptyQuestLog();
  if (!v || typeof v !== 'object') return log;
  const o = v as Partial<QuestLog>;
  const ints = (a: unknown, max: number) => (Array.isArray(a) ? a.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < max) : []);
  if (Array.isArray(o.main)) o.main.forEach((s, i) => i < log.main.length && Number.isInteger(s) && s >= 0 && s <= 3 && (log.main[i] = s));
  log.active = ints(o.active, MAIN_QUESTS.length);
  log.completed = ints(o.completed, MAIN_QUESTS.length);
  log.journal = ints(o.journal, 0x10000);
  return log;
}

export interface QuestOutcome {
  assigned: number[];
  completed: number[];
  journal: number[];
  xp: number;
  gold: number;
}

/**
 * Applies a main-story quest trigger to a quest log, as the original's handlers do:
 * journal start (0x496C00), assign (0x496990: to the active list), complete (0x496B40: an active
 * quest is finished with its reward (0x496A40); one never assigned is just marked done),
 * journal end. Side quests are not handled here.
 */
export function applyQuestAction(log: QuestLog, q: StoryQuestAction): QuestOutcome {
  const out: QuestOutcome = { assigned: [], completed: [], journal: [], xp: 0, gold: 0 };
  const quest = MAIN_QUESTS[q.index];
  if (!q.main || !quest) return out;
  const i = q.index;
  const note = (id: number) => {
    if (id >= 0 && !log.journal.includes(id)) {
      log.journal.push(id);
      out.journal.push(id);
    }
  };
  if (q.actions & QUEST_ACTION.JOURNAL_START) note(quest.journalStart);
  if (q.actions & QUEST_ACTION.ASSIGN && log.main[i] === QUEST_STATE.NONE) {
    log.main[i] = QUEST_STATE.ACTIVE;
    log.active.push(i);
    out.assigned.push(i);
  }
  if (q.actions & QUEST_ACTION.COMPLETE && log.main[i] !== QUEST_STATE.DONE) {
    // Only an assigned quest pays its reward (0x496A40); one never assigned is just marked done.
    const wasActive = log.main[i] === QUEST_STATE.ACTIVE;
    log.main[i] = QUEST_STATE.DONE;
    log.active = log.active.filter((a) => a !== i);
    log.completed.push(i);
    out.completed.push(i);
    if (wasActive) {
      out.xp += quest.xp;
      out.gold += quest.gold;
    }
  }
  if (q.actions & QUEST_ACTION.JOURNAL_END) note(quest.journalEnd);
  return out;
}

// ---------------------------------------------------------------------------------------------
// A character's story progress

/**
 * What a character has done in the story: the triggers fired ("<act>:<trigger id>", e.g.
 * "cs1a:204902": the original's flags, kept per act like its saved levels) and the quest book.
 */
export interface StoryState {
  flags: string[];
  quests: QuestLog;
}

export const STORY_FLAG = /^[a-z0-9_-]{1,24}:\d{1,9}$/;

export function emptyStoryState(): StoryState {
  return { flags: [], quests: emptyQuestLog() };
}

export function storyFlag(act: string, trigger: number): string {
  return `${act.toLowerCase()}:${trigger}`;
}

/** Saved story state (JSON), cleaned of anything malformed. */
export function sanitizeStoryState(v: unknown): StoryState {
  if (!v || typeof v !== 'object') return emptyStoryState();
  const o = v as Partial<StoryState>;
  const flags = Array.isArray(o.flags) ? [...new Set(o.flags.filter((f): f is string => typeof f === 'string' && STORY_FLAG.test(f)))].slice(0, 4096) : [];
  return { flags, quests: sanitizeQuestLog(o.quests) };
}
