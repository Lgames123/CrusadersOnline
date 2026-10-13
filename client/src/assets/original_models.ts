import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM, CREATURE_TEMPLATES, ORIGINAL_CLIP_FPS, isAttackAnim, isLocomotionAnim, npcArchetypeId, type AttackKind } from '@crusaders/shared';
import type { Avatar, AvatarKind } from '../entities/avatar.ts';

/**
 * Characters rendered with the original models and animations converted from the player's own
 * installation (imported in the browser, or `pnpm convert` in development), served at
 * /generated. Never shipped with the game; when unavailable the procedural avatars are used.
 */

/** Original model units appear to be feet (UNK-007); converted characters face -Z like the client. */
const UNIT_SCALE = 0.3048;
const FADE = 0.15;

interface ClipMap {
  idle: string;
  run: string;
  walk: string;
  air: string;
  attacks: string[];
  death: string;
  block: string;
  /** Backwards, running and careful sidesteps; filled from the model's ASM states when omitted. */
  retreat?: string;
  strafeLeft?: string;
  strafeRight?: string;
  walkStrafeLeft?: string;
  walkStrafeRight?: string;
  /** Forward / left / right + click attacks. */
  attackOverhead?: string;
  attackLeft?: string;
  attackRight?: string;
  attackLow?: string;
  attackJump?: string;
  attackThrust?: string;
  /** Rolls forward / back / left / right and ducking. */
  rolls?: string[];
  crouch?: string;
  /** Forward hop (ASM_HOP_F) before a creature's swing. */
  hop?: string;
  /** Standing with the shield up (ASM_COMBAT_STANDING, the combat stance). */
  shieldIdle?: string;
  /** Side hops (ASM_HOP_L / _R): sideways with the shield up. */
  hopLeft?: string;
  hopRight?: string;
  /** Hit reactions: front, left, right, back (ASM_IMPACT_*). */
  impacts?: string[];
  /** Knock-down (ASM_IMPACT_SEVERE, PI02). */
  knockdown?: string;
  /** Shield bash (ASM_RAM_SHOULDER, PL01). */
  bash?: string;
  /** Spell wind-up (ASM_SPELL_CONJURE). */
  conjure?: string;
  /** Death variants (ASM_HIT_POINTS_DEPLETED and its ALT_01..08). */
  deaths?: string[];
  /** Idle variations played now and then while standing (peaceful creatures: gestures, ALT stands). */
  gestures?: string[];
}

/**
 * Completes a clip map from the model's animation-state bindings (models.ctx `B` lines, kept by
 * the converter as `extras.asmStates`): the clips the original plays for each state.
 */
function withStates(base: ClipMap, states: Record<string, string> | undefined): ClipMap {
  const st = states ?? {};
  return {
    ...base,
    retreat: base.retreat ?? st['ASM_RETREAT'] ?? base.run,
    strafeLeft: base.strafeLeft ?? st['ASM_SIDE_STEP_L'] ?? base.run,
    strafeRight: base.strafeRight ?? st['ASM_SIDE_STEP_R'] ?? base.run,
    walkStrafeLeft: base.walkStrafeLeft ?? st['ASM_SIDE_STEP_L'] ?? base.walk,
    walkStrafeRight: base.walkStrafeRight ?? st['ASM_SIDE_STEP_R'] ?? base.walk,
    rolls: base.rolls ?? ['ASM_ROLL_F', 'ASM_ROLL_B', 'ASM_ROLL_L', 'ASM_ROLL_R'].map((k) => st[k] ?? base.run),
    crouch: base.crouch ?? st['ASM_CROUCHING'] ?? base.idle,
    // The quick shield block (ASM_BLOCK, PE07) rather than the slow ready-shield raise.
    block: st['ASM_BLOCK'] ?? base.block,
    hop: base.hop ?? st['ASM_HOP_F'] ?? base.run,
    shieldIdle: base.shieldIdle ?? st['ASM_COMBAT_STANDING'] ?? base.idle,
    hopLeft: base.hopLeft ?? st['ASM_HOP_L'] ?? base.strafeLeft ?? base.run,
    hopRight: base.hopRight ?? st['ASM_HOP_R'] ?? base.strafeRight ?? base.run,
    impacts: base.impacts ?? ['FRONT', 'LEFT', 'RIGHT', 'BACK'].map((k) => st[`ASM_IMPACT_${k}`]).filter((c): c is string => !!c),
    knockdown: base.knockdown ?? st['ASM_IMPACT_SEVERE'],
    bash: base.bash ?? st['ASM_RAM_SHOULDER'],
    conjure: base.conjure ?? st['ASM_SPELL_CONJURE'],
    deaths: base.deaths ?? [st['ASM_HIT_POINTS_DEPLETED'] ?? base.death, ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => st[`ASM_HIT_POINTS_DEPLETED_ALT_0${i}`]).filter((c): c is string => !!c)],
    attackOverhead: base.attackOverhead ?? st['ASM_SWING_OVERHEAD'] ?? base.attacks[0]!,
    attackLeft: base.attackLeft ?? st['ASM_SWING_LEVEL'] ?? base.attacks[0]!,
    attackLow: base.attackLow ?? st['ASM_CHOP_LOW'] ?? base.attacks[0]!,
    attackJump: base.attackJump ?? st['ASM_JUMP_ATTACK'] ?? base.attacks[0]!,
    attackThrust: base.attackThrust ?? st['ASM_THRUST'] ?? base.attacks[0]!,
    attackRight: base.attackRight ?? st['ASM_SWING_LEVEL'] ?? base.attacks[0]!,
  };
}

const STANDARD_CLIPS: ClipMap = { idle: 'pa21_id_br', run: 'pa01_ru_f', walk: 'pb01_w_fw', air: 'pa21_id_br', attacks: ['pn02_1_sw_lv', 'pn01_1_cp_lo', 'pn03_1_sw_ov'], death: 'pi03_hp', block: 'pt01_rdy_shld' };

/** Avatar kind -> converted model, optional texture variant (models.ctx `T` lines) and clips. */
/**
 * Equipment models held at the character's attachment dummies ("DMY XFRM WPN RIGHT" on the
 * right hand for the weapon, "DMY XFRM WPN LEFT" on the left forearm for the shield).
 */
interface Equipment {
  right?: string;
  left?: string;
}
/** Basic equipment: Long Sword and Wooden Shield (the skeletons' template equipment too). */
const BASIC_EQUIPMENT: Equipment = { right: 'longsword', left: 'woodshield' };

/**
 * Clips from the model's animation-state bindings alone (creatures whose skeletons are not the
 * human one): stance, locomotion, the three swings and death.
 */
function stateClips(st: Record<string, string>, relaxed = false): ClipMap {
  const idle = (relaxed ? st['ASM_STANDING'] ?? st['ASM_COMBAT_STANDING'] : st['ASM_COMBAT_STANDING'] ?? st['ASM_STANDING']) ?? '';
  // Peaceful creatures: the relaxed stand, with the gestures and alternative stands now and then.
  const gestures = relaxed
    ? Object.entries(st).filter(([k, v]) => v && (/^ASM_STANDING_ALT_\d+$/.test(k) || (/^ASM_GESTURE_/.test(k) && !/ANGRY|APPEASE/.test(k)))).map(([, v]) => v)
    : [];
  const swings = [st['ASM_SWING_LEVEL'], st['ASM_CHOP_LOW'], st['ASM_SWING_OVERHEAD']].filter((c): c is string => !!c);
  return {
    idle,
    run: st['ASM_RUNNING'] ?? idle,
    walk: st['ASM_WALKING'] ?? st['ASM_RUNNING'] ?? idle,
    air: st['ASM_FALL_SHORT'] ?? idle,
    attacks: swings.length ? swings : [idle],
    death: st['ASM_HIT_POINTS_DEPLETED'] ?? idle,
    block: st['ASM_BLOCK'] ?? st['ASM_READY_SHIELD'] ?? idle,
    ...(gestures.length ? { gestures: [...new Set(gestures)].filter((g) => g !== idle) } : {}),
  };
}

/** Creature template equipment (executable creature table): weapon and shield models. */
const MACE_METAL: Equipment = { right: 'standardmace', left: 'metalshield02' };

/** Held models of the creatures' template items (items.ctx Model ids resolved in models.ctx). */
const ITEM_MODELS: Record<string, string> = {
  long_sword: 'longsword', broad_sword: 'broadsword03', mace: 'standardmace', heavy_mace: 'heavymace', morning_star: 'morningstar',
  war_hammer: 'hammer', battle_axe: 'battleaxe', pick_axe: 'pickaxe', club: 'bluntclub', dasher_weapon: 'xucotal',
  dasher_hand_bow: 'handbow001', metal_shield: 'metalshield02', wooden_shield: 'woodshield',
};

/** Peaceful creatures (npc_<type>): model, texture and held items from the creature template table. */
const NPC_MODELS = Object.fromEntries(
  Object.entries(CREATURE_TEMPLATES).map(([type, t]) => {
    const right = t.weapon ? ITEM_MODELS[t.weapon] : undefined;
    const left = t.shield ? ITEM_MODELS[t.shield] : undefined;
    return [npcArchetypeId(Number(type)), { file: t.model, ...(t.texture ? { texture: t.texture } : {}), clips: null, relaxed: true, equipment: { ...(right ? { right } : {}), ...(left ? { left } : {}) } }];
  }),
);

const MODELS: Record<string, { file: string; texture?: string; clips: ClipMap | null; relaxed?: boolean; equipment?: Equipment }> = {
  ...NPC_MODELS,
  self: {
    file: 'drake',
    equipment: BASIC_EQUIPMENT,
    // Drake's ASM_SIDE_STEP states use the running sidesteps; Shift uses the careful ones.
    // Plain clicks: Drake's combo sequence in models.ctx (COMBO 1-3). Forward + click: the
    // overhead swing; left / right + click: the side swings (game Readme).
    clips: {
      // Measured in the original: Drake stands in PA21 (idle combat, 170-frame header), not PA16.
      idle: 'pa21_id_br', run: 'pa01_ru_f', walk: 'pb01_w_fw', air: 'pc03_ru_fw_jmp', death: 'pi03_hp', block: 'pt01_rdy_shld',
      // The five-step combo plays models.ctx's COMBO clips in file order (damage frames captured
      // in play match their IMPACT events).
      attacks: ['pn25_combo_a', 'pn02_1_sw_lv', 'pn15_1_chn_atk_a', 'pn16_1_chn_atk_b', 'pn17_1_pwr_atk'],
      attackOverhead: 'pn03_1_sw_ov', attackLeft: 'pn09_1_sw_l', attackRight: 'pn10_1_sw_r',
      walkStrafeLeft: 'pb02_sdstp_l', walkStrafeRight: 'pb03_sdstp_r',
    },
  },
  skeleton_ghost: { file: 'skeletonwarriorcollision', texture: 'walking_dead_ghost', clips: STANDARD_CLIPS, equipment: BASIC_EQUIPMENT },
  shadow: { file: 'skeletonwarriorcollision', texture: 'shadow', clips: STANDARD_CLIPS, equipment: BASIC_EQUIPMENT },
  dark_mage: { file: 'dark_magecollision', clips: { ...STANDARD_CLIPS, idle: 'pa16_id_br' }, equipment: MACE_METAL },
  // Creature template table: model index + texture variant (models.ctx), weapon and shield.
  dark_master: { file: 'dark_mastercollision', clips: null, equipment: { right: 'heavymace', left: 'metalshield02' } },
  dasher_brute: { file: 'm37tamris', texture: 'dasherbrute256', clips: null, equipment: { right: 'xucotal' } },
  ogre_outlaw: { file: 'male02', texture: 'male02ogre', clips: null, equipment: { right: 'battleaxe' } },
  dwarf_rebel: { file: 'm28_dwarf03average', texture: 'dwarf03ironpick', clips: null, equipment: { right: 'hammer', left: 'metalshield02' } },
  dwarf_zealot: { file: 'm28_dwarf02skinny', texture: 'dwarf02zealot', clips: null, equipment: { right: 'battleaxe', left: 'metalshield02' } },
  ice_titan: { file: 'male02', texture: 'male02icetitan', clips: null, equipment: { right: 'bluntclub' } },
  black_knight: { file: 'male01b', texture: 'male01bblackknight', clips: null, equipment: { right: 'broadsword03', left: 'metalshield02' } },
  deceiver: { file: 'deceiver', clips: null, equipment: { right: 'standardmace' } },
  skeleton_warrior: {
    file: 'skeletonwarriorcollision',
    equipment: BASIC_EQUIPMENT,
    clips: { idle: 'pa21_id_br', run: 'pa01_ru_f', walk: 'pb01_w_fw', air: 'pa21_id_br', attacks: ['pn02_1_sw_lv', 'pn01_1_cp_lo', 'pn03_1_sw_ov'], death: 'pi03_hp', block: 'pt01_rdy_shld' },
  },
};

class OriginalAvatar implements Avatar {
  readonly object = new THREE.Group();
  readonly headHeight: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly map: ClipMap;
  private current: THREE.AnimationAction | null = null;
  private anim = -1;
  /** The right-hand weapon's blade in its mount's frame (undefined: not looked up yet). */
  private bladeLocal: { mount: THREE.Object3D; held: THREE.Object3D | undefined; base: THREE.Vector3; tip: THREE.Vector3 } | null | undefined;

  blade(base: THREE.Vector3, tip: THREE.Vector3): boolean {
    // Every sword swing leaves one but the low chop while ducking (playtest); side and air
    // swings play on the upper body over the legs' clip.
    const a = this.anim;
    if (!((isAttackAnim(a) && a !== ANIM.ATTACK_LOW && a !== ANIM.ATTACK_BASH) || this.upperSwing)) return false;
    let b = this.bladeLocal;
    if (b === undefined || (b && b.held !== b.mount.children[0])) b = this.bladeLocal = findBlade(this.object);
    if (!b) return false;
    base.copy(b.base).applyMatrix4(b.mount.matrixWorld);
    tip.copy(b.tip).applyMatrix4(b.mount.matrixWorld);
    return true;
  }

  constructor(source: GLTF, map: ClipMap, texture?: THREE.Texture, equipment?: { right?: THREE.Object3D; left?: THREE.Object3D }) {
    const model = cloneSkinned(source.scene);
    model.scale.setScalar(UNIT_SCALE);
    if (equipment) attachEquipment(model, equipment);
    model.traverse((o) => {
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds do not follow animation
      const mesh = o as THREE.Mesh;
      if (texture && mesh.isMesh) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.map = texture;
        mesh.material = m;
      }
    });
    this.object.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = new Map(source.animations.map((c) => [c.name, c]));
    this.map = map;
    const box = new THREE.Box3().setFromObject(model);
    this.headHeight = box.max.y + 0.2;
    this.setState(ANIM.IDLE, 0);
  }

  private clipFor(anim: number): { name: string; loop: boolean } {
    const m = this.map;
    if (anim >= ANIM.ATTACK && anim < ANIM.ATTACK + 3) return { name: m.attacks[anim - ANIM.ATTACK] ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.ATTACK_COMBO4 || anim === ANIM.ATTACK_COMBO5) return { name: m.attacks[anim === ANIM.ATTACK_COMBO4 ? 3 : 4] ?? m.attacks[0]!, loop: false };
    if (anim >= ANIM.ROLL && anim < ANIM.ROLL + 4) return { name: m.rolls?.[anim - ANIM.ROLL] ?? m.run, loop: false };
    if (anim === ANIM.CROUCH) return { name: m.crouch ?? m.idle, loop: false };
    if (anim === ANIM.HOP_FORWARD) return { name: m.hop ?? m.run, loop: false };
    if (anim === ANIM.SHIELD_IDLE) return { name: m.idle, loop: true };
    if (anim === ANIM.ALERT) return { name: m.shieldIdle ?? m.idle, loop: true };
    if (anim === ANIM.HOP_LEFT) return { name: m.hopLeft ?? m.run, loop: false };
    if (anim === ANIM.HOP_RIGHT) return { name: m.hopRight ?? m.run, loop: false };
    if (anim === ANIM.ATTACK_OVERHEAD) return { name: m.attackOverhead ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.ATTACK_LEFT) return { name: m.attackLeft ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.ATTACK_RIGHT) return { name: m.attackRight ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.ATTACK_LOW) return { name: m.attackLow ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.ATTACK_JUMP) return { name: m.attackJump ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.ATTACK_THRUST) return { name: m.attackThrust ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.DEAD) {
      const deaths = m.deaths?.length ? m.deaths : [m.death];
      return { name: deaths[this.deathCount % deaths.length]!, loop: false };
    }
    if (anim === ANIM.HIT) return { name: m.impacts?.[0] ?? m.idle, loop: false };
    if (anim === ANIM.KNOCKDOWN) return { name: m.knockdown ?? m.impacts?.[0] ?? m.idle, loop: false };
    // ASM_IMPACT_MEDIUM has no clip of its own: the front impact, held.
    if (anim === ANIM.STUNNED) return { name: m.impacts?.[0] ?? m.idle, loop: false };
    if (anim === ANIM.ATTACK_BASH) return { name: m.bash ?? m.attacks[0]!, loop: false };
    if (anim === ANIM.SPELL_CONJURE) return { name: m.conjure ?? m.idle, loop: false };
    // Raise the shield once and hold the final pose.
    if (anim === ANIM.BLOCK) return { name: m.block, loop: false };
    if (anim === ANIM.RUN) return { name: m.run, loop: true };
    if (anim === ANIM.WALK) return { name: m.walk, loop: true };
    if (anim === ANIM.RETREAT) return { name: m.retreat ?? m.run, loop: true };
    if (anim === ANIM.STRAFE_LEFT) return { name: m.strafeLeft ?? m.run, loop: true };
    if (anim === ANIM.STRAFE_RIGHT) return { name: m.strafeRight ?? m.run, loop: true };
    if (anim === ANIM.WALK_STRAFE_LEFT) return { name: m.walkStrafeLeft ?? m.walk, loop: true };
    if (anim === ANIM.WALK_STRAFE_RIGHT) return { name: m.walkStrafeRight ?? m.walk, loop: true };
    if (anim === ANIM.AIRBORNE) return { name: m.air, loop: false };
    return { name: m.idle, loop: true };
  }

  private swingId = 0;
  private swingSeconds = 0;
  onEvent?: (name: string) => void;
  readonly hasEvents = true;
  /** Clip time of the current action at the previous update (event crossing detection). */
  private lastTime = 0;
  /** Picks the death variant; seeded per entity so every client shows the same one. */
  private deathCount = 0;
  /** Seconds left of a hit reaction overriding the current state. */
  private reactLeft = 0;
  /** Standing: seconds until the next idle gesture, and seconds left of the one playing. */
  private gestureIn = 6 + Math.random() * 10;
  private gestureLeft = 0;

  set seed(v: number) {
    this.deathCount = Math.abs(Math.trunc(v));
  }

  /** Hit reaction from a direction (0 front, 1 left, 2 right, 3 back), over the current state (a hit interrupts swings too). */
  react(dir: number): void {
    if (this.anim === ANIM.DEAD || this.anim === ANIM.KNOCKDOWN) return;
    const name = this.map.impacts?.[dir] ?? this.map.impacts?.[0];
    const clip = name ? this.clips.get(name) : undefined;
    if (!clip) return;
    this.play(clip, false, ORIGINAL_CLIP_FPS / 30);
    this.reactLeft = clip.duration / (ORIGINAL_CLIP_FPS / 30);
  }

  setState(anim: number, swingSeconds: number, swingId = 0): void {
    const restart = isAttackAnim(anim) && swingId !== this.swingId;
    this.swingId = swingId;
    this.swingSeconds = swingSeconds;
    if (anim === this.anim && !restart) return;
    if (this.anim === ANIM.DEAD && anim !== ANIM.DEAD) this.deathCount++;
    this.anim = anim;
    this.gestureLeft = 0; // a state change ends an idle gesture
    // Swings, deaths, knock-downs and stuns cut a hit reaction short; anything else waits for it to finish.
    if (this.reactLeft > 0 && !isAttackAnim(anim) && anim !== ANIM.DEAD && anim !== ANIM.KNOCKDOWN && anim !== ANIM.STUNNED) return;
    this.reactLeft = 0;
    this.apply();
  }

  private apply(): void {
    const anim = this.anim;
    const { name, loop } = this.clipFor(anim);
    // Models without a direction's clip fall back to their run cycle.
    const clip = this.clips.get(name) ?? (isLocomotionAnim(anim) ? this.clips.get(this.map.run) : undefined);
    if (!clip) return;
    // Every clip plays at the original's 1000/30 frames per second (converted clips are
    // timed at 30): swings then hit on their IMPACT frame, in step with the server.
    this.play(clip, loop, ORIGINAL_CLIP_FPS / 30);
  }

  /** Upper-body bones (Bip01 Spine and below): the shield layer's domain. */
  private upperBones: Set<string> | null = null;
  private shieldUp = false;
  private shieldAction: THREE.AnimationAction | null = null;
  private readonly lowerClips = new Map<string, THREE.AnimationClip>();
  private readonly upperClips = new Map<string, THREE.AnimationClip>();
  /** Upper-body swing in progress (side / air swings) and the seconds it has left. */
  private upperSwing: { action: THREE.AnimationAction; left: number } | null = null;
  private upperSwingKey = '';
  private baseClip: THREE.AnimationClip | null = null;
  private baseLoop = true;
  private baseScale = 1;

  private upper(): Set<string> {
    if (this.upperBones) return this.upperBones;
    const set = new Set<string>();
    const spine = this.object.getObjectByProperty('name', 'Bip01_Spine') ?? this.object.getObjectByProperty('name', 'Bip01 Spine');
    spine?.traverse((o) => set.add(THREE.PropertyBinding.sanitizeNodeName(o.name)));
    return (this.upperBones = set);
  }

  /** The clip without its upper-body tracks (legs only), cached. */
  private lowerOf(clip: THREE.AnimationClip): THREE.AnimationClip {
    let c = this.lowerClips.get(clip.name);
    if (!c) {
      const up = this.upper();
      c = new THREE.AnimationClip(`${clip.name}#lower`, clip.duration, clip.tracks.filter((t) => !up.has(t.name.split('.')[0]!)));
      this.lowerClips.set(clip.name, c);
    }
    return c;
  }

  /** The clip's upper-body tracks only (Bip01 Spine and below), cached. */
  private upperOf(clip: THREE.AnimationClip): THREE.AnimationClip {
    let c = this.upperClips.get(clip.name);
    if (!c) {
      const ub = this.upper();
      c = new THREE.AnimationClip(`${clip.name}#upper`, clip.duration, clip.tracks.filter((t) => ub.has(t.name.split('.')[0]!)));
      this.upperClips.set(clip.name, c);
    }
    return c;
  }

  /** Whether an upper-body layer (shield, side / air swing) overrides the base clip's upper body. */
  private get layered(): boolean {
    return this.shieldUp || this.upperSwing !== null;
  }

  setUpperSwing(kind: AttackKind | null, id: number): void {
    const key = kind ? `${kind}:${id}` : '';
    if (key === this.upperSwingKey) return;
    this.upperSwingKey = key;
    if (!kind || this.anim === ANIM.DEAD) return; // a swing ends with its clip
    const m = this.map;
    const name = kind === 'left' ? m.attackLeft : kind === 'right' ? m.attackRight : (m.attacks[1] ?? m.attacks[0]);
    const clip = name ? this.clips.get(name) : undefined;
    if (!clip) return;
    const was = this.layered;
    this.upperSwing?.action.stop();
    const action = this.mixer.clipAction(this.upperOf(clip));
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.timeScale = ORIGINAL_CLIP_FPS / 30;
    action.fadeIn(0.05).play();
    this.upperSwing = { action, left: clip.duration / action.timeScale };
    if (!was && this.baseClip) this.play(this.baseClip, this.baseLoop, this.baseScale);
  }

  setShield(up: boolean): void {
    if (up === this.shieldUp) return;
    const block = this.clips.get(this.map.block);
    if (!block || this.anim === ANIM.DEAD) return;
    const was = this.layered;
    this.shieldUp = up;
    if (up) {
      if (!this.shieldAction) {
        const ub = this.upper();
        const clip = new THREE.AnimationClip(`${block.name}#upper`, block.duration, block.tracks.filter((t) => ub.has(t.name.split('.')[0]!)));
        this.shieldAction = this.mixer.clipAction(clip);
        this.shieldAction.setLoop(THREE.LoopOnce, 1);
        this.shieldAction.clampWhenFinished = true; // hold the raised pose (the original holds its last frame)
      }
      this.shieldAction.reset();
      this.shieldAction.timeScale = ORIGINAL_CLIP_FPS / 30;
      this.shieldAction.fadeIn(0.1).play();
    } else {
      this.shieldAction?.fadeOut(0.15);
    }
    // The legs keep their clip; swap between the full and the legs-only version of it.
    if (was !== this.layered && this.baseClip) this.play(this.baseClip, this.baseLoop, this.baseScale);
  }

  private play(clip: THREE.AnimationClip, loop: boolean, timeScale: number): void {
    this.baseClip = clip;
    this.baseLoop = loop;
    this.baseScale = timeScale;
    const playing = this.layered ? this.lowerOf(clip) : clip;
    const keepTime = this.current && (this.current.getClip().name.split('#')[0] === clip.name) ? this.current.time : null;
    const action = this.mixer.clipAction(playing);
    action.reset();
    // Raising or lowering the shield does not restart the legs' clip.
    if (keepTime !== null) action.time = keepTime;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = timeScale;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, FADE, false);
    action.play();
    this.current = action;
    this.lastTime = action.time;
  }

  update(dt: number): void {
    if (this.upperSwing && (this.upperSwing.left -= dt) <= 0) {
      this.upperSwing.action.fadeOut(0.1);
      this.upperSwing = null;
      if (!this.layered && this.baseClip) this.play(this.baseClip, this.baseLoop, this.baseScale);
    }
    if (this.reactLeft > 0 && (this.reactLeft -= dt) <= 0) {
      this.reactLeft = 0;
      this.apply(); // back to the current state
    }
    // Peaceful creatures standing about: a gesture or alternative stand now and then.
    const gestures = this.map.gestures;
    if (gestures?.length && this.anim === ANIM.IDLE && this.reactLeft <= 0) {
      if (this.gestureLeft > 0) {
        if ((this.gestureLeft -= dt) <= 0) {
          this.gestureLeft = 0;
          this.gestureIn = 8 + Math.random() * 14;
          this.apply();
        }
      } else if ((this.gestureIn -= dt) <= 0) {
        const clip = this.clips.get(gestures[Math.floor(Math.random() * gestures.length)]!);
        if (clip) {
          this.play(clip, false, ORIGINAL_CLIP_FPS / 30);
          this.gestureLeft = clip.duration / (ORIGINAL_CLIP_FPS / 30);
        } else this.gestureIn = 8;
      }
    }
    const before = this.current;
    const prev = this.lastTime;
    this.mixer.update(dt);
    const cur = this.current;
    if (!cur) return;
    const now = cur.time;
    // Authored clip events (times in the clip's 30 fps frames), including loop wrap-around.
    const events = this.events.get(cur.getClip().name.split('#')[0]!);
    if (events && this.onEvent && cur === before) {
      const dur = cur.getClip().duration;
      for (const e of events) {
        const t = e.frame / 30;
        const crossed = now >= prev ? t > prev && t <= now : t > prev || t <= now;
        if (crossed && t <= dur) this.onEvent(e.name);
      }
    }
    this.lastTime = now;
  }

  /** Clip name -> authored events (converter extras). */
  events = new Map<string, { frame: number; name: string }[]>();

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

/**
 * Hangs equipment models on the attachment dummies kept in the model's extras (raw MDL values:
 * rotation quaternion w, x, y, z — w first, unlike the bones — then translation, relative to
 * the dummy's bone), converted to glTF space with the same Z mirror as the bones.
 */
function attachEquipment(model: THREE.Object3D, equipment: { right?: THREE.Object3D; left?: THREE.Object3D }): void {
  let dummies: { name: string; node: number; values: number[] }[] | undefined;
  model.traverse((o) => (dummies ??= (o.userData as { transforms?: { name: string; node: number; values: number[] }[] }).transforms));
  if (!dummies?.length) return;
  const bones: THREE.Bone[] = [];
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && bones.length === 0) bones.push(...(o as THREE.SkinnedMesh).skeleton.bones);
  });
  for (const d of dummies) {
    const side = d.name.endsWith('RIGHT') ? 'right' : d.name.endsWith('LEFT') ? 'left' : null;
    const item = side ? equipment[side] : undefined;
    const bone = bones[d.node];
    if (!item || !bone || d.values.length < 7) continue;
    const [w, x, y, z, tx, ty, tz] = d.values as [number, number, number, number, number, number, number];
    const mount = new THREE.Object3D();
    mount.name = d.name;
    mount.quaternion.set(-x, -y, z, w).normalize();
    mount.position.set(tx, ty, -tz);
    const held = item.clone(true);
    held.traverse((o) => (o.castShadow = true));
    // Items are mounted by their node frame: undo the node transform baked into their vertices.
    let node: { rotation: number[]; translation: number[] } | undefined;
    held.traverse((o) => (node ??= (o.userData as { nodeTransform?: { rotation: number[]; translation: number[] } }).nodeTransform));
    if (node) {
      const q = new THREE.Quaternion(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]).normalize().invert();
      held.quaternion.copy(q);
      held.position.set(node.translation[0]!, node.translation[1]!, node.translation[2]!).applyQuaternion(q).negate();
    }
    mount.add(held);
    bone.add(mount);
  }
}

/**
 * The weapon held at the right-hand dummy, as a segment in the mount's frame: along the item's
 * longest extent, from a quarter of the way out of the hand to the far end (the tip).
 */
function findBlade(model: THREE.Object3D): { mount: THREE.Object3D; held: THREE.Object3D | undefined; base: THREE.Vector3; tip: THREE.Vector3 } | null {
  let mount: THREE.Object3D | undefined;
  model.traverse((o) => {
    if (!mount && o.name.endsWith('WPN RIGHT')) mount = o;
  });
  if (!mount || !mount.children.length) return null;
  model.updateMatrixWorld(true);
  const toMount = new THREE.Matrix4().copy(mount.matrixWorld).invert();
  const box = new THREE.Box3();
  mount.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toMount, mesh.matrixWorld)));
  });
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const centre = box.getCenter(new THREE.Vector3());
  const lo = centre.clone();
  const hi = centre.clone();
  lo[axis] = box.min[axis];
  hi[axis] = box.max[axis];
  const [near, far] = lo.length() <= hi.length() ? [lo, hi] : [hi, lo];
  return { mount, held: mount.children[0], base: near.lerp(far, 0.25), tip: far };
}

export type AvatarFactory = (kind: AvatarKind) => Avatar | null;

/** Resolves to a factory for original-model avatars, or null when not available. */
export async function loadOriginalAvatars(): Promise<AvatarFactory | null> {
  try {
    const res = await fetch('/generated/manifest.json');
    if (!res.ok) return null;
    const manifest = (await res.json()) as { models: Record<string, string>; textures: Record<string, string> };
    const loader = new GLTFLoader();
    const textures = new THREE.TextureLoader();
    const gltfs = new Map<string, GLTF>();
    const loaded = new Map<string, { gltf: GLTF; clips: ClipMap; events: Map<string, { frame: number; name: string }[]>; texture?: THREE.Texture; equipment: { right?: THREE.Object3D; left?: THREE.Object3D } }>();
    /** Equipment model scenes by file name (textures resolve relative to the .glb). */
    const props = new Map<string, THREE.Object3D | null>();
    const prop = async (file: string | undefined): Promise<THREE.Object3D | undefined> => {
      if (!file) return undefined;
      if (!props.has(file)) {
        const url = manifest.models[file];
        props.set(file, url ? (await loader.loadAsync(`/generated/${url}`).catch(() => null))?.scene ?? null : null);
      }
      return props.get(file) ?? undefined;
    };
    for (const [kind, def] of Object.entries(MODELS)) {
      const url = manifest.models[def.file];
      if (!url) continue;
      let gltf = gltfs.get(url);
      if (!gltf) gltfs.set(url, (gltf = await loader.loadAsync(`/generated/${url}`)));
      let texture: THREE.Texture | undefined;
      const texUrl = def.texture ? manifest.textures[def.texture] : undefined;
      if (texUrl) {
        texture = await textures.loadAsync(`/generated/${texUrl}`);
        texture.flipY = false; // glTF texture convention
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
      let states: Record<string, string> | undefined;
      gltf.scene.traverse((o) => (states ??= (o.userData as { asmStates?: Record<string, string> }).asmStates));
      // Clip events (footsteps, swing, impact...) are kept in each animation's glTF extras.
      const events = new Map<string, { frame: number; name: string }[]>();
      const json = (gltf.parser as unknown as { json: { animations?: { name?: string; extras?: { events?: { frame: number; name: string }[] } }[] } }).json;
      for (const an of json.animations ?? []) {
        if (an.name && an.extras?.events?.length) events.set(an.name, an.extras.events.map((e) => ({ frame: e.frame, name: e.name.trim() })));
      }
      const right = await prop(def.equipment?.right);
      const left = await prop(def.equipment?.left);
      const equipment = { ...(right ? { right } : {}), ...(left ? { left } : {}) };
      const base = def.clips ?? (states ? stateClips(states, def.relaxed) : null);
      if (!base || !base.idle) continue;
      loaded.set(kind, { gltf, clips: withStates(base, states), events, equipment, ...(texture ? { texture } : {}) });
    }
    if (loaded.size === 0) return null;
    console.info(`[assets] using original models from your installation: ${[...loaded.keys()].join(', ')}`);
    return (kind) => {
      const entry = loaded.get(kind === 'player' ? 'self' : kind);
      if (!entry) return null;
      const avatar = new OriginalAvatar(entry.gltf, entry.clips, entry.texture, entry.equipment);
      avatar.events = entry.events;
      return avatar;
    };
  } catch (err) {
    console.warn('[assets] original models unavailable:', err);
    return null;
  }
}
