import { LUNGE_TICKS, TICK_RATE } from '../constants.ts';
import { CREATURE_TEMPLATES, npcArchetypeId } from './creatures.ts';
import { originalMaxHp, type Attributes } from './original_stats.ts';
import { ATTACK_MODE_SCALE, type DamageVector } from './ruleset.ts';

/**
 * Combat and progression rules shared by server (authority) and client (presentation).
 * Damage, HP, resist and experience formulas follow the original engine (original_stats.ts,
 * ruleset.ts, executable-analysis.md §8–9); creature HP, XP and resists are the most common
 * values of the original level placements (asset-format-discovery.md §6). Swing timings and AI
 * parameters are vertical-slice values.
 */
const ticks = (ms: number) => Math.round((ms / 1000) * TICK_RATE);

export interface SwingTiming {
  /** Ticks before the hitbox becomes active. */
  startup: number;
  /** Ticks during which the hitbox can connect. */
  active: number;
  /** Ticks after the active window before the next action. */
  recovery: number;
}

/** Base swing at weapon speed 1.0; see swingForWeaponSpeed(). */
export const PLAYER_SWING: Readonly<SwingTiming> = { startup: ticks(150), active: ticks(150), recovery: ticks(250) };

/** Weapon `Speed` scales the animation rate (engine field +0x28), so swings get shorter. */
export function swingForWeaponSpeed(speed: number, base: Readonly<SwingTiming> = PLAYER_SWING): SwingTiming {
  const s = speed > 0 ? speed : 1;
  return {
    startup: Math.max(1, Math.round(base.startup / s)),
    active: Math.max(1, Math.round(base.active / s)),
    recovery: Math.max(1, Math.round(base.recovery / s)),
  };
}
/**
 * The original plays every clip at 1000/30 frames per second (× the character's speed
 * multiplier, ~1 at level 1) and its swings follow each attack clip's SWING / IMPACT /
 * RECOVERY events (executable-analysis.md §14). Frame numbers of Drake's clips:
 */
export const ORIGINAL_CLIP_FPS = 1000 / 30;
/**
 * A clip's SWING / IMPACT / RECOVERY frames and, for the player's swings, its header +0x14:
 * the attack state holds until the clip time passes end - 1 (controller flag 4, 0x00429257;
 * 0x00429BF0 keeps every swing state until then), well after RECOVERY for most clips.
 */
export interface ClipEvents { swing: number; impact: number; recovery: number; end?: number }
/**
 * Plain clicks chain five swings (combo routine 0x0042CA20: states 24 → 23 → 25 → 103 → 104).
 * With a one-handed weapon they play models.ctx's "COMBO" clips in file order — the damage
 * frames captured in play match their IMPACT events: PN25_combo_a, PN02_1_sw_lv,
 * PN15_1_chn_atk_a, PN16_1_chn_atk_b, PN17_1_pwr_atk.
 */
const COMBO_CLIPS: readonly ClipEvents[] = [
  { swing: 11, impact: 13, recovery: 18, end: 18 },
  { swing: 7, impact: 8, recovery: 13, end: 25 },
  { swing: 7, impact: 9, recovery: 15, end: 23 },
  { swing: 5, impact: 10, recovery: 17, end: 28 },
  { swing: 11, impact: 12, recovery: 23, end: 31 },
];
/** Movement key + click (original controls): overhead PN03, side swings PN09/PN10, low PN01, jump PN05. */
const DIRECTIONAL_CLIPS: Readonly<Record<'overhead' | 'left' | 'right' | 'low' | 'jump', ClipEvents>> = {
  overhead: { swing: 10, impact: 12, recovery: 16, end: 40 },
  left: { swing: 5, impact: 8, recovery: 14 },
  right: { swing: 8, impact: 9, recovery: 14 },
  low: { swing: 14, impact: 16, recovery: 19, end: 39 },
  jump: { swing: 17, impact: 20, recovery: 24, end: 43 },
};
/** Drake's jab (PP02, header 25) and shield rush (PL01, header 24): the same events as the creatures'. */
const PLAYER_THRUST: ClipEvents = { swing: 6, impact: 9, recovery: 17, end: 25 };
const PLAYER_BASH: ClipEvents = { swing: 4, impact: 9, recovery: 24, end: 24 };
/**
 * Swing clips play at the clip rate x (1 + 1.5 x (weapon Speed - 1)) (0x00429BF0, for the swing,
 * jab and leap states; the shield rush at the clip rate alone).
 */
export function weaponClipRate(weaponSpeed: number): number {
  const s = weaponSpeed > 0 ? weaponSpeed : 1;
  return Math.max(0.1, 1 + 1.5 * (s - 1));
}
/**
 * Side swings and the air swing play SWING_LEVEL (PN02, ASM state 23) on the upper-body layer
 * (player controller 0x429BF0, layer state 2) over the legs' movement. A new layer swing starts
 * only once the layer is free: the clip plays whole (~0.745 s at speed 1, not scaled by the
 * weapon), then the layer weight falls at 12/s (0x428DD0) and the layer clears. Clicks meanwhile
 * are dropped; the next swing needs a click after that. Logged with clicks every ~90 ms: one
 * side swing every ~0.91 s, either side, no alternation.
 */
export const LAYERED_CLIP_SECONDS = 0.745;
export const LAYER_FADE_SECONDS = 1 / 12;
export const LAYERED_SWING_SECONDS = LAYERED_CLIP_SECONDS + LAYER_FADE_SECONDS;
/**
 * Feature sideSwingRetrigger (not original, an earlier misreading of a capture): a side swing
 * re-triggers 0.3 s into the previous one and consecutive side swings alternate sides.
 */
export const SIDE_SWING_CHAIN_SECONDS = 0.3;
export const SIDE_SWING_RECHAIN_TICKS = Math.round(SIDE_SWING_CHAIN_SECONDS * TICK_RATE);
/**
 * A plain click with level geometry within 5 ft ahead (probed 5.5 ft above the feet, routine
 * 0x00437BE0 called from the combo routine 0x0042CA20) plays the jab (ASM_THRUST, PP02) instead
 * of the combo swing, and resets the combo.
 */
export const THRUST_WALL_DISTANCE = 5 * 0.3048;
export const THRUST_WALL_HEIGHT = 5.5 * 0.3048;
/** Frames after RECOVERY before the next swing can start (observed chain hand-over). */
const CHAIN_SLACK_FRAMES = 3;

/**
 * Swing timing of an attack (kind + combo step), scaled by the weapon's Speed and by the
 * character's clip rate (its speed multiplier, stats +0x24C: every clip plays at 1000/30 x it).
 */
export function attackTiming(kind: 'normal' | 'overhead' | 'left' | 'right' | 'low' | 'jump' | 'thrust' | 'bash' | 'air', combo: number, weaponSpeed = 1, clipRate = 1): SwingTiming {
  const rate = weaponClipRate(weaponSpeed) * clipRate;
  if (kind === 'thrust') return clipSwingTiming(PLAYER_THRUST, rate);
  if (kind === 'bash') return clipSwingTiming(PLAYER_BASH, clipRate);
  // Side and air swings: SWING_LEVEL (PN02) on the upper-body layer, held until the layer frees
  // (the clip at the clip rate, not the weapon's; then the layer's 1/12 s fade).
  if (kind === 'air' || kind === 'left' || kind === 'right') {
    const t = clipSwingTiming(COMBO_CLIPS[1]!, clipRate);
    t.recovery = Math.max(1, Math.round((LAYERED_CLIP_SECONDS / clipRate + LAYER_FADE_SECONDS) * TICK_RATE) - t.startup - t.active);
    return t;
  }
  const c = kind === 'normal' ? COMBO_CLIPS[Math.min(Math.max(combo, 1), COMBO_CLIPS.length) - 1]! : DIRECTIONAL_CLIPS[kind];
  return clipSwingTiming(c, rate);
}

const FT = 0.3048;
type MobSwingKind = 'overhead' | 'normal' | 'low';
/**
 * A creature attack: its ASM state's attack kind, the clip's SWING / IMPACT / RECOVERY frames
 * and its reach (centre to centre, metres).
 */
export interface MobAttack {
  kind: 'normal' | 'overhead' | 'low' | 'thrust' | 'bash' | 'jump';
  clip: ClipEvents;
  reach: number;
  /**
   * Later SWING events of the clip (frames): each starts the sweep again (0x00457A60 ->
   * Swing_Component_Start), so the hit list clears and the reach becomes this one's.
   */
  again?: readonly { frame: number; reach: number }[];
  /** Its clip has no SWING event: it plays and moves but hits nothing (0x00457A60 never starts a sweep). */
  harmless?: boolean;
}
/**
 * Reach of the creature attacks: the executable's attack table (.data 0x004EA200: state, angle
 * range, reach in feet) gives SWING_OVERHEAD and SWING_LEVEL 7.5 ft, CHOP_LOW and THRUST 6 ft.
 * (The aim lookup that would read it, 0x004619E0, is a stub; the original's hits come from the
 * blade's sweep. Logged skeleton hits landed at 4.0-5.25 ft, a lower bound.)
 */
const reachFt = (ft: number) => ft * FT;
/** Creature swings: the clips bound to SWING_LEVEL (PN02), CHOP_LOW (PN01) and SWING_OVERHEAD (PN03). */
export const MOB_ATTACKS: readonly MobAttack[] = [
  { kind: 'normal', clip: { swing: 7, impact: 8, recovery: 13 }, reach: reachFt(7.5) },
  { kind: 'low', clip: { swing: 14, impact: 16, recovery: 19 }, reach: reachFt(6) },
  { kind: 'overhead', clip: { swing: 10, impact: 12, recovery: 16 }, reach: reachFt(7.5) },
];
/** Close-range jab (ASM_THRUST, PP02: SWING 6, RECOVERY 17; no IMPACT event, hit on frame 9). */
export const MOB_THRUST: MobAttack = { kind: 'thrust', clip: { swing: 6, impact: 9, recovery: 17 }, reach: reachFt(6) };
/**
 * Shield bash (ASM_RAM_SHOULDER, PL01: 24 frames, no events; the charge covers 6.5 ft by
 * frame 11). Logged: the player was stunned (ASM_IMPACT_MEDIUM) without damage.
 */
export const MOB_BASH: MobAttack = { kind: 'bash', clip: { swing: 4, impact: 9, recovery: 24 }, reach: reachFt(6) };
/**
 * The shield rush (ASM_RAM_SHOULDER; Drake's is Space + RMB). Decompiled (0x48CF00 / 0x4920A0 set
 * physics flag 0x40000 while the state is RAM_SHOULDER; the body sweep 0x493F20 uses it): a charge
 * that runs into another character's body pushes it by 0.3 of the rest of the move and stops
 * against it; then each such blocked step rolls round(rand x 10) == 0 (5 %) for: the victim's
 * impact (controller 0x8000) and stun (physics 0x80000), 1 HP lost by a rushing player (the
 * normal HP loss, flinch roll and death included), sounds 0 and 338 at the rusher. No shield
 * check. The roll runs per rendered frame; at RUSH_STEPS_PER_SECOND it matches the live log
 * (impact at once, Drake losing 2-5 HP per rush).
 */
export const RUSH_PUSH_SHARE = 0.3;
export const RUSH_STEP_CHANCE = 0.05;
export const RUSH_STEPS_PER_SECOND = 120;
/** Bodies still count as touching this far apart (the original's sweep meets them on contact). */
export const RUSH_CONTACT_SLACK = 0.5 * FT;
/** Leaping strike (ASM_JUMP_ATTACK, PN05). */
export const MOB_JUMP_ATTACK: MobAttack = { kind: 'jump', clip: { swing: 17, impact: 20, recovery: 24 }, reach: reachFt(7.5) };

/** The attack a creature plays for each of the brain's attack states. */
export interface MobAttackSet {
  normal: MobAttack;
  low: MobAttack;
  overhead: MobAttack;
  thrust: MobAttack;
  jump: MobAttack;
  bash: MobAttack;
}
/** The humanoid creatures' (PN02, PN01, PN03, PP02, PN05, PL01). */
export const HUMANOID_ATTACKS: MobAttackSet = {
  normal: MOB_ATTACKS[0]!, low: MOB_ATTACKS[1]!, overhead: MOB_ATTACKS[2]!, thrust: MOB_THRUST, jump: MOB_JUMP_ATTACK, bash: MOB_BASH,
};
/**
 * The elementals' (IceElemental.mdl; Ice, Rock and Lava share it). A blow is swept by the model's
 * own lines, DMY LINE LEFT HAND / RIGHT HAND on the fingers (0x00421D50: line 0, 1, or for
 * "SWING DOUBL" the segment between their midpoints), from a SWING event until the first event
 * named exactly RECOVERY (0x00482E90; 60 frames when there is none, so to the clip's end), one
 * hit per sweep. Reach: the farthest the lines get ahead of the clip's start over each sweep
 * (forward kinematics on the clips, feet), times the creature's scale (the lines are on the
 * scaled model).
 * - SWING_LEVEL and SWING_OVERHEAD bind M18C01ice_a_h: SWING DOUBL 25, RECOVERY 32; 11.5 ft.
 * - CHOP_LOW binds M18C02ice_a_m: SWING START 10, then "SWING RECOVERY" 19 and 28 and SWING START
 *   28 (all SWING events, none named RECOVERY): sweeps from 10 (8.1 ft), 19 (11.8) and 28 (12.8)
 *   to the clip's end, 43 frames.
 * - No ASM_THRUST clip: the state falls back to the first of its group (0x00428220, table
 *   0x004EBD18 group 0x20: CHOP_LOW, SWING_LEVEL, SWING_OVERHEAD) with one, CHOP_LOW.
 * - ASM_JUMP_ATTACK M18A07ice_jmp_f (32 frames) and ASM_RAM_SHOULDER ice_ram_shoulder (45) carry
 *   no events: they never hit.
 */
const ELEMENTAL_HIGH: MobAttack = { kind: 'normal', clip: { swing: 25, impact: 32, recovery: 32 }, reach: reachFt(11.5) };
const ELEMENTAL_LOW: MobAttack = {
  kind: 'low', clip: { swing: 10, impact: 42, recovery: 42, end: 43 }, reach: reachFt(8.1),
  again: [{ frame: 19, reach: reachFt(11.8) }, { frame: 28, reach: reachFt(12.8) }],
};
export const ELEMENTAL_ATTACKS: MobAttackSet = {
  normal: ELEMENTAL_HIGH,
  low: ELEMENTAL_LOW,
  overhead: { ...ELEMENTAL_HIGH, kind: 'overhead' },
  thrust: ELEMENTAL_LOW,
  jump: { kind: 'jump', clip: { swing: 1, impact: 1, recovery: 31, end: 32 }, reach: 0, harmless: true },
  bash: { kind: 'bash', clip: { swing: 4, impact: 9, recovery: 44, end: 45 }, reach: reachFt(6) },
};
/** An attack's reach for a creature of this scale (its hit lines are on the scaled model). */
export function scaledAttack(a: MobAttack, scale: number): MobAttack {
  if (scale === 1) return a;
  return { ...a, reach: a.reach * scale, ...(a.again ? { again: a.again.map((g) => ({ ...g, reach: g.reach * scale })) } : {}) };
}
/** Creatures scaled above this never hop in and add 3 to the standing attack roll (0x004083F0). */
export const MOB_BIG_SCALE = 1.5;

/**
 * The original's melee brain (decompiled: 0x00409520 and the routines it runs). Distances are
 * centre to centre, in bands (0x0040E6B0): up to 8 ft, 12 ft, 20 ft, beyond.
 */
export const MOB_BAND_FT: readonly number[] = [8, 12, 20];
export function mobBand(distance: number): 0 | 1 | 2 | 3 {
  const ft = distance / FT;
  return ft <= MOB_BAND_FT[0]! ? 0 : ft <= MOB_BAND_FT[1]! ? 1 : ft <= MOB_BAND_FT[2]! ? 2 : 3;
}
/**
 * Distance a creature closes to before it attacks (0x0040EA30): 8 ft; dwarves (types 124-130,
 * 161) 4.2 ft; Dasher Scout / Brute, Deceiver and Tamris (132-134, 148) 5 ft.
 */
export const MOB_ENGAGE = 8 * FT;
/**
 * Attack choice (0x004083F0): beyond 7 ft a creature with a forward hop hops in; under 5 ft it
 * jabs; otherwise it swings where it stands. A roll of 12 picks the sequence: one swing (3 of
 * 12, 500 ms pause after), two (5 of 12, 700 ms) or three (4 of 12, 900 ms). Hopping, the first
 * swing plays on the upper body from 20 % of the hop (behaviour templates 14-16) and the rest
 * standing after it; the one-swing hop ends in the combat stance.
 */
export const MOB_HOP_ATTACK_RANGE = 7 * FT;
export const MOB_THRUST_ATTACK_RANGE = 5 * FT;
const MOB_SEQUENCES: readonly (readonly MobSwingKind[])[] = [
  ['overhead'], ['low'], ['normal'],
  ['normal', 'overhead'], ['low', 'overhead'], ['normal', 'normal'], ['overhead', 'normal'], ['overhead', 'low'],
  ['low', 'normal', 'overhead'], ['normal', 'normal', 'overhead'], ['overhead', 'low', 'low'], ['overhead', 'low', 'normal'],
];
/** Pause in the combat stance after a sequence of 1 / 2 / 3 attacks (the templates' times). */
export const MOB_SEQUENCE_PAUSE_MS: readonly number[] = [500, 700, 900];
/** ASM_HOP_F (PC07): 33 frames at 1000/30 fps, 5.65 ft of root motion. */
export const MOB_HOP_TICKS = LUNGE_TICKS;
/** The hop's first swing starts at 20 % of ASM_HOP_F. */
export const MOB_HOP_SWING_DELAY = Math.round(0.2 * LUNGE_TICKS);

export interface MobSequence {
  /** Opens with the forward hop. */
  hop: boolean;
  /** Played on the upper body from 20 % of the hop. */
  upper: MobAttack | null;
  /** Played one after another (after the hop when there is one). */
  main: MobAttack[];
  /** Combat-stance pause once the sequence is over, ms. */
  pauseMs: number;
}

/**
 * The attack sequence for a creature `distance` metres from its target (`roll` in [0, 1)), from
 * its attack set; a creature scaled above 1.5 never hops and adds 3 to the standing roll.
 */
export function chooseMobSequence(distance: number, roll: number, canHop = true, set: MobAttackSet = HUMANOID_ATTACKS, scale = 1): MobSequence {
  const swing = (k: MobSwingKind) => set[k];
  const big = scale > MOB_BIG_SCALE;
  const r = Math.min(11, Math.floor(roll * 12));
  if (distance > MOB_HOP_ATTACK_RANGE && canHop && !big) {
    const [first, ...rest] = MOB_SEQUENCES[r]!;
    return { hop: true, upper: swing(first!), main: rest.map(swing), pauseMs: MOB_SEQUENCE_PAUSE_MS[rest.length]! };
  }
  if (distance < MOB_THRUST_ATTACK_RANGE) return { hop: false, upper: null, main: [set.thrust], pauseMs: MOB_SEQUENCE_PAUSE_MS[0]! };
  const seq = MOB_SEQUENCES[Math.min(11, r + (big ? 3 : 0))]!;
  return { hop: false, upper: null, main: seq.map(swing), pauseMs: MOB_SEQUENCE_PAUSE_MS[seq.length - 1]! };
}

/**
 * Against a target holding its shield up, one attack decision in five (a roll of 1000 above
 * 800, 0x00409920) is a special (0x004087A0): a shielded creature rams with the shield and jabs
 * (2 of 3) or leaps (1 of 3); one without a shield leaps.
 */
export const MOB_SPECIAL_ROLL = 0.8;
export function chooseMobSpecial(hasShield: boolean, roll: number, set: MobAttackSet = HUMANOID_ATTACKS, rams = false): MobSequence {
  if (hasShield && Math.floor(roll * 3) < 2) return { hop: false, upper: null, main: [set.bash, set.thrust], pauseMs: MOB_SEQUENCE_PAUSE_MS[1]! };
  // Necros, shieldless, rams instead of leaping.
  if (rams && !hasShield) return { hop: false, upper: null, main: [set.bash], pauseMs: MOB_SEQUENCE_PAUSE_MS[0]! };
  return { hop: false, upper: null, main: [set.jump], pauseMs: MOB_SEQUENCE_PAUSE_MS[0]! };
}

/**
 * After a sequence a shielded creature (0x00409C30) attacks again at once if its target is
 * within 8 ft and neither swinging nor blocking; otherwise it raises its shield (template 17:
 * COMBAT_STANDING with ASM_BLOCK, PE07, on the upper body) for the block clip, 26 frames.
 */
export const MOB_SHIELD_TICKS = Math.round((26 / ORIGINAL_CLIP_FPS) * TICK_RATE);
/**
 * One without a shield (0x0040A500), for up to 1.5 s: steps back (ASM_RETREAT) while within
 * 8 ft, stands in its combat stance at 8-12 ft, and decides again early once the target is
 * beyond 12 ft or has turned away (more than 90 degrees).
 */
export const MOB_POST_TICKS = Math.round(1.5 * TICK_RATE);
/** Body turn towards the heading the brain sets (0x004918E0, standing): 270 degrees a second. */
export const MOB_TURN_RATE = (270 * Math.PI) / 180;
/**
 * Noticing the player (0x0040D910, hostile creatures): within 100 ft when the player is less
 * than 60 degrees off the creature's heading, 20 ft otherwise, and in sight (a ray through the
 * level, 0x00406AF0).
 */
export const MOB_SIGHT_RANGE = 100 * FT;
export const MOB_SIGHT_HALF_ANGLE = (60 * Math.PI) / 180;
export const MOB_NEAR_SENSE_RANGE = 20 * FT;

export function clipSwingTiming(c: Readonly<ClipEvents>, weaponSpeed = 1): SwingTiming {
  const s = weaponSpeed > 0 ? weaponSpeed : 1;
  const at = (frame: number) => Math.round((frame / ORIGINAL_CLIP_FPS / s) * TICK_RATE);
  const startup = Math.max(1, at(c.swing));
  const active = Math.max(1, at(c.impact) - startup + 1);
  // The player's swings hold to the clip's end; creatures' (whose behaviour templates time
  // their attacks) a few frames past RECOVERY.
  const recovery = Math.max(1, at(c.end !== undefined ? c.end - 1 : c.recovery + CHAIN_SLACK_FRAMES) - startup - active);
  return { startup, active, recovery };
}

/**
 * The shove of a blow (0x0044D290): the victim gets an impulse of 10 (4 when its shield stops
 * the blow) along the sweep of the attacker's blade tip (0x0048CDA0: the tip's previous minus
 * current position, x -10), unless stunned. The physics (0x00492B70, 0x004920A0, 0x004923E0,
 * 0x00491E20) turn it into one frame of velocity: twice 156.8 x 0.033 x the impulse, less the
 * quadratic drag 0.5 x |v local| (whose vertical part is the grounded -5 ft/s) x dt; the next
 * frame the clip's own speed bounds the velocity again. The physics constants assume 30 frames
 * a second. The sweep at the damage frame, horizontal part of its unit vector in the attacker's
 * frame (x right, z forward), measured on the clips with the Long Sword (local/re/tools/blade.ts).
 */
const SWEEP_PLAYER_COMBO: readonly (readonly [number, number])[] = [[0.18, 0.88], [-0.04, 0.88], [0.7, 0.1], [0.45, 0.89], [-0.94, 0.14]];
const SWEEP: Readonly<Record<string, readonly [number, number]>> = {
  level: [-0.04, 0.88], overhead: [-0.18, 0.56], low: [-0.19, 0.62], jump: [-0.24, 0.61], thrust: [-0.56, 0.17],
};
/** Horizontal sweep (x right, z forward) of an attack at its damage frame; null for the shield bash. */
export function attackSweep(kind: string, combo: number): readonly [number, number] | null {
  if (kind === 'normal') return SWEEP_PLAYER_COMBO[Math.min(Math.max(combo, 1), 5) - 1]!;
  if (kind === 'left' || kind === 'right' || kind === 'air') return SWEEP.level!;
  return SWEEP[kind] ?? null;
}
/** Distance (m) a blow shoves its victim, from the horizontal part `h` of the sweep's unit vector. */
export function hitShove(h: number, blocked: boolean): number {
  const dt = 1 / 30;
  const c = 156.8 * 0.033;
  const impulse = (blocked ? 4 : 10) * h;
  const factor = 1 - 0.5 * Math.hypot(c * impulse, 5) * dt;
  return factor > 0 ? 2 * c * impulse * factor * dt * 0.3048 : 0;
}

/**
 * The combo routine (0x0042CA20, run every frame the attack button is held): once 10 % of a
 * combo swing's clip has played, the request queues the next step (none after the fifth), which
 * starts when the swing ends; a request after the swing has ended starts the combo again.
 */
export const COMBO_QUEUE_FRACTION = 0.1;
/** Five-hit combo; every step uses the normal attack mode (the 1.25 mode is a difficulty setting). */
export const COMBO_MULTIPLIERS = [1, 1, 1, 1, 1].map(() => ATTACK_MODE_SCALE.normal);
/**
 * Melee reach beyond the target's radius and arc. Captured hits landed up to 5.95 ft centre to
 * centre and ~40° off the heading, and a head-on swing missed at 7.6 ft (executable-analysis.md
 * §14.1); within that bracket, 7.5 ft: the reach the executable's attack table gives the same
 * humanoid swing on a creature (MOB_ATTACKS).
 */
export const PLAYER_REACH = 7.5 * 0.3048 - 0.4;
export const PLAYER_ARC_DEG = 90;

export const PLAYER_RESPAWN_TICKS = ticks(5000);
export const MAX_LEVEL = 50;

/** XP added to the next-level threshold when reaching level n (index = new level); 4000 from level 6. */
const XP_STEP = [0, 500, 1000, 2000, 3000, 4000] as const;
const XP_STEP_LATE = 4000;

/** Total XP needed to reach `level` (engine Stats_LevelUp): 0, 500, 1500, 3500, 6500, 10500, +4000... */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 2; l <= level; l++) total += l - 1 < XP_STEP.length ? XP_STEP[l - 1]! : XP_STEP_LATE;
  return total;
}

export interface MobArchetype {
  id: string;
  name: string;
  maxHp: number;
  /** Item id of the creature's weapon (creature template table); creatures deal its whole damage vector. */
  weapon: string;
  /** Item id of its shield, if any. */
  shield: string | null;
  /** Damage-taken multipliers per type (level placement data, SLASH ... DARK). */
  resist: DamageVector;
  /**
   * Reactive block (optional feature, off by default: WorldZoneOptions.reactiveBlock): chance
   * to raise the shield when a player starts a swing at it, how long it stays up, and the
   * minimum time before the next block. Not original behaviour: logged skeletons only raised
   * the shield in their stance (MOB_SHIELD_*, executable-analysis §15.2).
   */
  blockChance: number;
  blockTicks: number;
  blockCooldown: number;
  /** Chase speed, m/s. */
  speed: number;
  /** Distance it closes to before attacking (0x0040EA30; MOB_ENGAGE unless the type says otherwise). */
  engage: number;
  /** Distance from its spawn beyond which the mob gives up and returns. */
  leashRadius: number;
  reach: number;
  arcDeg: number;
  swing: SwingTiming;
  xpReward: number;
  goldMin: number;
  goldMax: number;
  /** Items that may drop into the killer's inventory, each rolled independently (slice values). */
  loot: readonly { itemId: string; chance: number }[];
  /** Ticks the corpse stays before the mob respawns. */
  respawnTicks: number;
  /** Peaceful creature (citizens, guards, merchants): never aggressive, cannot be hit. */
  passive?: boolean;
  /** The creature type id (template table, 113-162): what spells test (holy wrath, soul drinker, freeze resist). */
  type?: number;
  /** Unarmed damage per type (stats +0x18), added to the weapon's; placements carry their own. */
  unarmed?: DamageVector;
  /** Its attacks (clips, hit windows, reach) for the brain's attack states; absent: HUMANOID_ATTACKS. */
  attacks?: MobAttackSet;
  /** Shieldless, its special against a raised shield is the ram, not the leap (Necros, 0x004087A0). */
  rams?: boolean;
  /** Ignores the impact of a blow (controller flag 0x8000; only Necros, 0x00426C70). */
  steadfast?: boolean;
  /** Its blows always knock the player down (0x0044CA00: a source of type 0x96 sets 0x4000000). */
  knocksDown?: boolean;
  /**
   * Locomotion from its own clips (feet and frames, at 1000/30 fps) instead of the humanoid rig's:
   * run, walk, retreat, sidesteps left / right.
   */
  locomotion?: { run: [number, number]; walk: [number, number]; retreat: [number, number]; left: [number, number]; right: [number, number] };
}

/**
 * Melee creatures of the original levels. Loadouts come from the creature template table
 * (executable-analysis.md §9.1); HP, XP and resists are overridden per placement in original
 * levels (the values here are each type's most common placement). They share the original's melee
 * brain (MOB_* above) with their type's engage distance; loot is a slice value.
 */
function meleeVariant(base: MobArchetype, over: Partial<MobArchetype> & Pick<MobArchetype, 'id' | 'name'>): MobArchetype {
  return { ...base, loot: [], ...over };
}

/** The elementals' locomotion clips (IceElemental.mdl: ice_run, m18a01ice_w_fw, ice_retreat, m18a02 / m18a03 sidesteps). */
const ELEMENTAL_LOCOMOTION: NonNullable<MobArchetype['locomotion']> = {
  run: [17.98, 20], walk: [8.26, 33], retreat: [5.17, 44], left: [8.57, 38], right: [4.13, 38],
};

const SKELETON_WARRIOR: MobArchetype = {
  id: 'skeleton_warrior',
  name: 'Skeleton Warrior',
  // Original: 25 HP, 40 XP and these resists in 357 of 480 level placements; loadout from the
  // creature template table (Long Sword + Wooden Shield).
  maxHp: 25,
  weapon: 'long_sword',
  shield: 'wooden_shield',
  resist: [0.9, 1.1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.75],
  blockChance: 0.35,
  blockTicks: ticks(700),
  blockCooldown: ticks(1500),
  speed: 4.2,
  engage: MOB_ENGAGE,
  // Skeletons followed the player for more than 75 m in the original.
  leashRadius: 80,
  // Skeleton hits on the player were captured from 4.0 to 5.25 ft centre to centre.
  reach: 5.25 * 0.3048 - 0.4,
  arcDeg: 90,
  swing: { startup: ticks(400), active: ticks(150), recovery: ticks(500) },
  xpReward: 40,
  goldMin: 5,
  goldMax: 10,
  loot: [
    { itemId: 'long_sword', chance: 0.25 },
    { itemId: 'scale_armor', chance: 0.1 },
  ],
  respawnTicks: ticks(10_000),
};

export const MOB_ARCHETYPES: Record<string, MobArchetype> = {
  skeleton_warrior: SKELETON_WARRIOR,
  // Skeleton Ghost: Long Sword + Wooden Shield, casts lightning; 40 HP, 75 XP.
  skeleton_ghost: meleeVariant(SKELETON_WARRIOR, {
    id: 'skeleton_ghost', name: 'Skeleton Ghost', maxHp: 40, xpReward: 75,
    resist: [1, 0.75, 1, 0.75, 1.25, 1, 1.1, 1.5, 1, 1.25, 0.5],
  }),
  // Shadow: Heavy Mace + Wooden Shield; 60 HP, 200 XP.
  shadow: meleeVariant(SKELETON_WARRIOR, {
    id: 'shadow', name: 'Shadow', maxHp: 60, xpReward: 200, weapon: 'heavy_mace',
    resist: [0.5, 0.25, 0.5, 0.5, 0.5, 0.5, 1.25, 1.25, 0, 1.5, 0.25],
  }),
  // Dark Mage: Mace + Metal Shield, casts soul drinker and fire balls (spells.ts CREATURE_SPELLS); 45 HP, 60 XP.
  dark_mage: meleeVariant(SKELETON_WARRIOR, {
    id: 'dark_mage', name: 'Dark Mage', maxHp: 45, xpReward: 60, weapon: 'mace', shield: 'metal_shield',
    resist: [1, 1, 0.75, 0.75, 0.75, 0.75, 1, 1, 1, 1.25, 0.5],
  }),
  // Dark Master: Heavy Mace + Metal Shield, casts unholy wrath and fire balls; 80 HP, 125 XP.
  dark_master: meleeVariant(SKELETON_WARRIOR, {
    id: 'dark_master', name: 'Dark Master', maxHp: 80, xpReward: 125, weapon: 'heavy_mace', shield: 'metal_shield',
    resist: [1, 1, 1, 0.5, 0.5, 0.5, 0.5, 1, 1, 1.35, 0.25],
  }),
  // Dasher Brute: Dasher Weapon; 30 HP, 50 XP (201 of 273 placements).
  dasher_brute: meleeVariant(SKELETON_WARRIOR, {
    id: 'dasher_brute', name: 'Dasher Brute', maxHp: 30, xpReward: 50, weapon: 'dasher_weapon', shield: null, engage: 5 * 0.3048,
    resist: [0.8, 1.2, 1, 1, 1, 1, 0.75, 1, 0.75, 0, 0],
  }),
  // Ogre Outlaw: Battle Axe; 100 HP, 75 XP.
  ogre_outlaw: meleeVariant(SKELETON_WARRIOR, {
    id: 'ogre_outlaw', name: 'Ogre Outlaw', maxHp: 100, xpReward: 75, weapon: 'battle_axe', shield: null,
    resist: [1, 1, 1, 1, 1, 1, 1.25, 1, 0.75, 0, 0],
  }),
  // Dwarf Ironpick Rebel: War Hammer + Metal Shield; 40 HP, 60 XP.
  dwarf_rebel: meleeVariant(SKELETON_WARRIOR, {
    id: 'dwarf_rebel', name: 'Dwarf Ironpick Rebel', maxHp: 40, xpReward: 60, weapon: 'war_hammer', shield: 'metal_shield', engage: 4.2 * 0.3048,
    resist: [0.9, 0.8, 1, 1, 0.5, 1, 0.8, 1, 0.8, 0, 0],
  }),
  // Dwarf Ironpick Zealot: Battle Axe + Metal Shield; 60 HP, 100 XP.
  dwarf_zealot: meleeVariant(SKELETON_WARRIOR, {
    id: 'dwarf_zealot', name: 'Dwarf Ironpick Zealot', maxHp: 60, xpReward: 100, weapon: 'battle_axe', shield: 'metal_shield', engage: 4.2 * 0.3048,
    resist: [0.75, 0.5, 1, 1, 0.5, 1, 0.5, 1, 0.5, 0, 0],
  }),
  // Ice Titan: Club; 125 HP, 150 XP.
  ice_titan: meleeVariant(SKELETON_WARRIOR, {
    id: 'ice_titan', name: 'Ice Titan', maxHp: 125, xpReward: 150, weapon: 'club', shield: null,
    resist: [1, 1, 1.25, 1, 1, 0.5, 1, 1, 1, 0, 0],
  }),
  // Greater Black Knight: Broad Sword + Metal Shield; 100 HP, 180 XP.
  black_knight: meleeVariant(SKELETON_WARRIOR, {
    id: 'black_knight', name: 'Greater Black Knight', maxHp: 100, xpReward: 180, weapon: 'broad_sword', shield: 'metal_shield',
    resist: [0.5, 0.5, 0.2, 0.5, 0.2, 0.2, 0, 0, 0, 0, 0],
  }),
  // Deceiver: Mace; its homing fire ball plays a throw with no SPELL event (nothing leaves); 201 HP, 250 XP.
  deceiver: meleeVariant(SKELETON_WARRIOR, {
    id: 'deceiver', name: 'Deceiver', maxHp: 201, xpReward: 250, weapon: 'mace', shield: null, engage: 5 * 0.3048,
    resist: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 1, 0],
  }),
  // Elementals (IceElemental.mdl, unarmed, one template each: texture ice / stoneelemental /
  // fireelemental): their fist blows (ELEMENTAL_ATTACKS) and own locomotion clips (ice_run 18 ft
  // in 20 frames, m18a01ice_w_fw 8.3 / 33, ice_retreat 5.2 / 44, sidesteps 8.6 and 4.1 / 38).
  // Their fire ball (spell masks 0x20 / 0x80) plays ASM_THROW_ITEM, icewalk, with no SPELL event.
  // HP, XP, resists and unarmed damage: the placements' (Ice 36 of 37, Rock and Lava all).
  ice_elemental: meleeVariant(SKELETON_WARRIOR, {
    id: 'ice_elemental', name: 'Ice Elemental', maxHp: 175, xpReward: 200, weapon: 'unarmed', shield: null,
    resist: [0.25, 1, 1.5, 1, 1, 0, 0, 0, 1, 0, 0], unarmed: [0, 10, 0, 0, 0, 20, 0, 0, 0, 0, 0],
    attacks: ELEMENTAL_ATTACKS, locomotion: ELEMENTAL_LOCOMOTION,
  }),
  rock_elemental: meleeVariant(SKELETON_WARRIOR, {
    id: 'rock_elemental', name: 'Rock Elemental', maxHp: 150, xpReward: 125, weapon: 'unarmed', shield: null,
    resist: [1, 1, 1, 1.25, 0, 1, 1, 1, 0.75, 0, 0], unarmed: [0, 10, 0, 0, 10, 0, 0, 0, 0, 0, 0],
    attacks: ELEMENTAL_ATTACKS, locomotion: ELEMENTAL_LOCOMOTION,
  }),
  lava_elemental: meleeVariant(SKELETON_WARRIOR, {
    id: 'lava_elemental', name: 'Lava Elemental', maxHp: 200, xpReward: 250, weapon: 'unarmed', shield: null,
    resist: [0.5, 0.75, 0, 1, 0.75, 1.25, 1, 1, 1, 0, 0], unarmed: [0, 10, 30, 0, 0, 0, 0, 0, 0, 0, 0],
    attacks: ELEMENTAL_ATTACKS, locomotion: ELEMENTAL_LOCOMOTION,
  }),
  // Necros (type 150, bs1a): unarmed, his forearm's DMY LINE NECRARM sweeps the humanoid swings
  // (6-7 ft, the attack table's reach); 1000 HP, DARK 40 unarmed. Never flinches, knocks the
  // player down with every blow, rams a raised shield, casts soul drinker, unholy wrath, triple
  // fire balls and his Force Globe (spells.ts NECROS_SPELLS). He fights where he stands: no leash.
  necros: meleeVariant(SKELETON_WARRIOR, {
    id: 'necros', name: 'Necros', maxHp: 1000, xpReward: 10, weapon: 'unarmed', shield: null,
    resist: [0.8, 0.8, 0.21, 0.24, 0.22, 0.21, 0.43, 0.13, 0.3, 0.3, 0], unarmed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
    rams: true, steadfast: true, knocksDown: true, leashRadius: Infinity, respawnTicks: ticks(300_000),
  }),
  // Ghost Father (type 156, the Cs4b inn): Male04b in Male04bGhostFather, holding the Longsword of
  // the Crusader; 150 HP, 200 XP; FIRE x5, everything else x0.2; SPIRIT / BODY / LIGHT / DARK 4 unarmed.
  ghost_father: meleeVariant(SKELETON_WARRIOR, {
    id: 'ghost_father', name: 'Ghost Father', maxHp: 150, xpReward: 200, shield: null,
    resist: [0.2, 0.2, 5, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2], unarmed: [0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4],
  }),
  // The Spectral Ally spell's creature (type 155, disposition 6: on the caster's side; 0x00440230).
  // HP, weapon damage and resists are set per spell level when it is summoned.
  spectral_ally: meleeVariant(SKELETON_WARRIOR, {
    id: 'spectral_ally', name: 'Spectral Ally', maxHp: 80, xpReward: 0, goldMin: 0, goldMax: 0, respawnTicks: ticks(3_600_000),
    resist: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], leashRadius: Infinity,
  }),
};

/** Creature type ids of the melee archetypes (the template table's records). */
const ARCHETYPE_TYPES: Readonly<Record<string, number>> = {
  skeleton_warrior: 145, skeleton_ghost: 146, shadow: 147, dark_mage: 143, dark_master: 144, dasher_brute: 133,
  ogre_outlaw: 131, dwarf_rebel: 124, dwarf_zealot: 125, ice_titan: 135, black_knight: 116, deceiver: 134, spectral_ally: 155,
  ice_elemental: 136, rock_elemental: 137, lava_elemental: 138, necros: 150, ghost_father: 156,
};
for (const [id, type] of Object.entries(ARCHETYPE_TYPES)) MOB_ARCHETYPES[id]!.type = type;

/**
 * Peaceful creatures of the original levels (placements whose disposition is not hostile), one
 * archetype per creature type, from the creature template table: they stand at their place.
 */
const NPC_ARCHETYPES: Record<string, MobArchetype> = Object.fromEntries(
  Object.entries(CREATURE_TEMPLATES).map(([type, t]) => [
    npcArchetypeId(Number(type)),
    meleeVariant(SKELETON_WARRIOR, {
      id: npcArchetypeId(Number(type)), name: t.name, passive: true, maxHp: 100, xpReward: 0, goldMin: 0, goldMax: 0, respawnTicks: ticks(60_000),
      weapon: t.weapon ?? 'unarmed', shield: t.shield, resist: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], type: Number(type),
    }),
  ]),
);
Object.assign(MOB_ARCHETYPES, NPC_ARCHETYPES);

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Original formula: 50 + 0.6 × Endurance × level, rounded for the protocol. */
export function playerMaxHp(attributes: Attributes, level: number): number {
  return Math.round(originalMaxHp(attributes, level));
}

/** Facing vector for a yaw in radians (yaw 0 faces -Z, counter-clockwise from above). */
export function forwardXZ(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Yaw (radians) that faces from (fromX, fromZ) towards (toX, toZ). */
export function yawTowards(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

/** True if the target lies within `reach` metres and inside the forward cone of `arcDeg` degrees. */
export function inMeleeArc(ax: number, az: number, yaw: number, tx: number, tz: number, reach: number, arcDeg: number, targetRadius = 0): boolean {
  const dx = tx - ax;
  const dz = tz - az;
  const dist = Math.hypot(dx, dz);
  if (dist > reach + targetRadius) return false;
  if (dist < 1e-6) return true;
  const f = forwardXZ(yaw);
  const cos = (dx * f.x + dz * f.z) / dist;
  return cos >= Math.cos(((arcDeg / 2) * Math.PI) / 180);
}
