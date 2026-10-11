import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM, isLocomotionAnim } from '@crusaders/shared';
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
  };
}

const STANDARD_CLIPS: ClipMap = { idle: 'pa21_id_br', run: 'pa01_ru_f', walk: 'pb01_w_fw', air: 'pa21_id_br', attacks: ['pn02_1_sw_lv', 'pn01_1_cp_lo', 'pn03_1_sw_ov'], death: 'pi03_hp', block: 'pt01_rdy_shld' };

/** Avatar kind -> converted model, optional texture variant (models.ctx `T` lines) and clips. */
const MODELS: Record<string, { file: string; texture?: string; clips: ClipMap }> = {
  self: {
    file: 'drake',
    // Drake's ASM_SIDE_STEP states use the running sidesteps; Shift uses the careful ones.
    clips: { idle: 'pa16_id_br', run: 'pa01_ru_f', walk: 'pb01_w_fw', air: 'pc03_ru_fw_jmp', attacks: ['pn09_1_sw_l', 'pn10_1_sw_r', 'pn03_1_sw_ov'], death: 'pi03_hp', block: 'pt01_rdy_shld', walkStrafeLeft: 'pb02_sdstp_l', walkStrafeRight: 'pb03_sdstp_r' },
  },
  skeleton_ghost: { file: 'skeletonwarriorcollision', texture: 'walking_dead_ghost', clips: STANDARD_CLIPS },
  shadow: { file: 'skeletonwarriorcollision', texture: 'shadow', clips: STANDARD_CLIPS },
  dark_mage: { file: 'dark_magecollision', clips: { ...STANDARD_CLIPS, idle: 'pa16_id_br' } },
  skeleton_warrior: {
    file: 'skeletonwarriorcollision',
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

  constructor(source: GLTF, map: ClipMap, texture?: THREE.Texture) {
    const model = cloneSkinned(source.scene);
    model.scale.setScalar(UNIT_SCALE);
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
    if (anim === ANIM.DEAD) return { name: m.death, loop: false };
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

  setState(anim: number, swingSeconds: number): void {
    if (anim === this.anim) return;
    this.anim = anim;
    const { name, loop } = this.clipFor(anim);
    // Models without a direction's clip fall back to their run cycle.
    const clip = this.clips.get(name) ?? (isLocomotionAnim(anim) ? this.clips.get(this.map.run) : undefined);
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    // Fit attack clips to the authoritative swing duration.
    action.timeScale = !loop && swingSeconds > 0 && anim !== ANIM.DEAD && anim !== ANIM.BLOCK ? clip.duration / swingSeconds : 1;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, FADE, false);
    action.play();
    this.current = action;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
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
    const loaded = new Map<string, { gltf: GLTF; clips: ClipMap; texture?: THREE.Texture }>();
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
      loaded.set(kind, { gltf, clips: withStates(def.clips, states), ...(texture ? { texture } : {}) });
    }
    if (loaded.size === 0) return null;
    console.info(`[assets] using original models from your installation: ${[...loaded.keys()].join(', ')}`);
    return (kind) => {
      const entry = loaded.get(kind === 'player' ? 'self' : kind);
      return entry ? new OriginalAvatar(entry.gltf, entry.clips, entry.texture) : null;
    };
  } catch (err) {
    console.warn('[assets] original models unavailable:', err);
    return null;
  }
}
