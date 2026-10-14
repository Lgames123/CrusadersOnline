import * as THREE from 'three';
import {
  ANIM,
  ASM_STATE_NAMES,
  DEFAULT_MOVEMENT_STATS,
  LEVEL_UNIT_METRES,
  SEQUENCE_ACTOR_BASE,
  SequenceRun,
  cameraPathPoint,
  type LevelStory,
  type StepHandle,
  type StoryArg,
  type StoryCamera,
  type StorySequence,
  type StoryStep,
} from '@crusaders/shared';
import type { Avatar } from '../entities/avatar.ts';
import type { SoundBank } from '../audio/sound_bank.ts';

/**
 * Plays a scripted sequence on this client (story.ts / sequence.ts; executable-analysis.md §17):
 * the shared scheduler starts the steps, and this drives them: the stand-in for Drake (the local
 * avatar) and the creatures taking part move, turn and play their ASM clips, voice lines play
 * with their subtitles, the screen fades, and the sequence's cameras fly their paths. The server
 * froze the player and applies the outcome when told it is over.
 */
export interface Puppet {
  object: THREE.Object3D;
  avatar: Avatar;
  name: string;
}

export interface CutsceneContext {
  story: LevelStory;
  sequence: StorySequence;
  /** Puppet playing actor `index` (2 = the first), or null if absent. */
  actor(index: number): Puppet | null;
  /** The creature placed as `placement` in the act (sequences name some things by it). */
  creature(placement: number): Puppet | null;
  /** Where the player stood when the sequence started (actor 0, frozen meanwhile). */
  playerSpot: THREE.Vector3;
  sounds: SoundBank | null;
  /** Shows a voice line's subtitle for `ms`. */
  subtitle(speaker: string | null, text: string, ms: number): void;
  /** Fade to black (`out`) or back over `ms`. */
  fade(out: boolean, ms: number): void;
}

/** Body turn rate of creatures in sequences, rad/s (the brain's 270 degrees a second). */
const TURN_RATE = (270 * Math.PI) / 180;
const FT = LEVEL_UNIT_METRES;
/** Run / walk speeds from the humanoid rig's root motion (m/s). */
const RUN_SPEED = DEFAULT_MOVEMENT_STATS.runSpeed;
const WALK_SPEED = DEFAULT_MOVEMENT_STATS.walkSpeed;
/** ASM state ids MoveToPos asks for (arg movestate). */
const ASM_RUNNING = 1;

const num = (a: StoryArg | undefined, d = 0): number => (typeof a === 'number' ? a : d);

export class Cutscene {
  readonly sequence: StorySequence;
  readonly camera: THREE.PerspectiveCamera;
  private readonly ctx: CutsceneContext;
  private readonly run: SequenceRun;
  private cam: { def: StoryCamera; eyeT: number; targetT: number } | null = null;
  private readonly eye: [number, number, number] = [0, 0, 0];
  private readonly look: [number, number, number] = [0, 0, 0];
  private readonly stops: (() => void)[] = [];
  /** Things to do a while after their step has counted as done (a clip ending). */
  private readonly later: { ms: number; fn: () => void }[] = [];
  /** The latest step driving each puppet's body (a later step overrides an earlier one's leftovers). */
  private readonly owner = new Map<Puppet, number>();
  private serial = 0;

  constructor(ctx: CutsceneContext, base: THREE.PerspectiveCamera) {
    this.ctx = ctx;
    this.sequence = ctx.sequence;
    this.camera = base.clone();
    if (ctx.sequence.camera !== undefined) this.setCamera(ctx.sequence.camera);
    else this.camera.copy(base);
    this.run = new SequenceRun(ctx.sequence, { start: (step, _i, actor) => this.start(step, actor) });
  }

  get finished(): boolean {
    return this.run.finished;
  }

  update(dt: number): void {
    this.run.update(dt * 1000);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i]!;
      if ((l.ms -= dt * 1000) > 0) continue;
      this.later.splice(i, 1);
      l.fn();
    }
    if (this.cam) {
      this.cam.eyeT += dt * 1000 * this.cam.def.eye.rate;
      this.cam.targetT += dt * 1000 * this.cam.def.target.rate;
      cameraPathPoint(this.cam.def.eye, this.cam.eyeT, this.eye);
      cameraPathPoint(this.cam.def.target, this.cam.targetT, this.look);
      this.camera.position.set(this.eye[0] * FT, this.eye[1] * FT, this.eye[2] * FT);
      this.camera.lookAt(this.look[0] * FT, this.look[1] * FT, this.look[2] * FT);
    }
  }

  /** Stops anything still playing (voice lines). */
  dispose(): void {
    for (const s of this.stops) s();
    this.stops.length = 0;
  }

  private setCamera(id: number): void {
    const def = this.ctx.story.cameras.find((c) => c.id === id);
    if (def) this.cam = { def, eyeT: 0, targetT: 0 };
  }

  /** A reference argument's position (metres), if it names something placed. */
  private refPosition(a: StoryArg | undefined, out: THREE.Vector3): THREE.Vector3 | null {
    if (Array.isArray(a)) return out.set(a[0] * FT, a[1] * FT, a[2] * FT);
    if (!a || typeof a !== 'object') return null;
    if ('player' in a) {
      if (a.player === 'player') return out.copy(this.ctx.playerSpot);
      const p = this.ctx.actor(this.standIn());
      return p ? out.copy(p.object.position) : null;
    }
    if ('creature' in a) {
      const p = this.puppetOfCreature(a.creature);
      return p ? out.copy(p.object.position) : null;
    }
    return null;
  }

  private standIn(): number {
    const i = this.sequence.actors.findIndex((a) => a && 'player' in a);
    return i >= 0 ? i + SEQUENCE_ACTOR_BASE : SEQUENCE_ACTOR_BASE;
  }

  private puppetOfCreature(creature: number): Puppet | null {
    const i = this.sequence.actors.findIndex((a) => a && 'creature' in a && a.creature === creature);
    return i >= 0 ? this.ctx.actor(i + SEQUENCE_ACTOR_BASE) : this.ctx.creature(creature);
  }

  private start(step: StoryStep, actor: number): StepHandle | null {
    const a = step.args;
    const puppet = this.ctx.actor(actor);
    switch (step.action) {
      case 'PlaySound': {
        const id = num(a['sound'], -1);
        const line = this.ctx.sounds?.lines.get(id);
        const stop = this.ctx.sounds?.play(id, null, { volume: 1 });
        if (stop) this.stops.push(stop);
        if (line) this.ctx.subtitle(this.speaker(a['source'], line.file), line.text, line.ms);
        return null;
      }
      case 'FadeOut':
        this.ctx.fade(num(a['fade_out'], 1) !== 0, num(a['fade_time'], 1000));
        return null;
      case 'CameraTimeline': {
        const ref = a['camera'];
        if (!ref || typeof ref !== 'object' || !('camera' in ref)) return null;
        this.setCamera(ref.camera);
        const cam = this.cam;
        return cam ? { update: () => cam.eyeT >= 1 || this.cam !== cam } : null;
      }
      case 'Appear': {
        if (!puppet) return null;
        const show = num(a['appear'], 1) !== 0;
        puppet.object.visible = show;
        const at = a['appearpos'];
        if (show && Array.isArray(at)) puppet.object.position.set(at[0] * FT, at[1] * FT, at[2] * FT);
        return null;
      }
      case 'MoveToPos':
        return puppet ? this.moveTo(puppet, a) : null;
      case 'FaceRel':
        return puppet ? this.face(puppet, a) : null;
      case 'RunAnimation':
        return puppet ? this.animate(puppet, a) : null;
      default:
        // Timeline, Wait (timed by the scheduler); TriggerFlag, DoInteraction, ScriptedSequenceDone
        // (the server applies them).
        return null;
    }
  }

  /** Subtitle speaker: a creature's name, Drake for his lines (DK_ files, the stand-in). */
  private speaker(source: StoryArg | undefined, file: string): string | null {
    if (/^dk_/.test(file)) return 'Drake';
    if (source && typeof source === 'object' && 'creature' in source) return this.puppetOfCreature(source.creature)?.name ?? null;
    return null;
  }

  private moveTo(p: Puppet, a: Record<string, StoryArg>): StepHandle {
    const target = new THREE.Vector3();
    if (!this.refPosition(a['pos'], target)) return { update: () => true };
    const run = num(a['movestate'], 2) === ASM_RUNNING;
    const speed = (run ? RUN_SPEED : WALK_SPEED) * (p.avatar.clipRate ?? 1);
    const near = Math.max(0.1, num(a['distance'], 0) * FT);
    p.avatar.setState(run ? ANIM.RUN : ANIM.WALK, 0);
    const mine = ++this.serial;
    this.owner.set(p, mine);
    const from = p.object.position;
    return {
      update: (dtMs) => {
        const dx = target.x - from.x, dz = target.z - from.z;
        const d = Math.hypot(dx, dz);
        if (d <= near) {
          if (this.owner.get(p) === mine) p.avatar.setState(ANIM.IDLE, 0);
          return true;
        }
        const step = Math.min(d, (speed * dtMs) / 1000);
        from.x += (dx / d) * step;
        from.z += (dz / d) * step;
        p.object.rotation.y = turn(p.object.rotation.y, Math.atan2(-dx, -dz), (TURN_RATE * 2 * dtMs) / 1000);
        return false;
      },
    };
  }

  private face(p: Puppet, a: Record<string, StoryArg>): StepHandle {
    const target = new THREE.Vector3();
    const never = num(a['neverdone'], 0) !== 0;
    const body = num(a['bodymove'], 0) !== 0;
    return {
      update: (dtMs) => {
        if (!this.refPosition(a['thingtoface'], target)) return true;
        const want = Math.atan2(-(target.x - p.object.position.x), -(target.z - p.object.position.z));
        if (body) p.object.rotation.y = turn(p.object.rotation.y, want, (TURN_RATE * dtMs) / 1000);
        const off = Math.abs(Math.atan2(Math.sin(want - p.object.rotation.y), Math.cos(want - p.object.rotation.y)));
        return !never && (!body || off < 0.02);
      },
    };
  }

  private animate(p: Puppet, a: Record<string, StoryArg>): StepHandle {
    const state = ASM_STATE_NAMES[num(a['animation'], 7)] ?? 'ASM_STANDING';
    const t0 = num(a['t0'], 0);
    const t1 = num(a['t1'], 1) || 1;
    const freeze = num(a['freeze_at_end'], 1) !== 0;
    const seconds = p.avatar.playAsm?.(state, { t0, t1, speed: num(a['speed'], 1) || 1, loop: num(a['continuous'], 0) !== 0, freeze }) ?? null;
    // The step counts as done at `tdone` of the clip's played range (it may go on playing); a
    // clip not frozen at its end goes back to standing.
    const mine = ++this.serial;
    this.owner.set(p, mine);
    if (seconds !== null && !freeze) this.later.push({ ms: seconds * 1000, fn: () => this.owner.get(p) === mine && p.avatar.setState(ANIM.IDLE, 0) });
    let left = (seconds ?? 1) * Math.max(0, num(a['tdone'], 1)) * 1000;
    return { update: (dtMs) => (left -= dtMs) <= 0 };
  }
}

function turn(from: number, to: number, max: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-max, Math.min(max, d));
}
