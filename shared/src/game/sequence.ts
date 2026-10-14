import { SEQUENCE_ACTOR_BASE, type StorySequence, type StoryStep } from './story.ts';

/**
 * Runs a scripted sequence's steps on time (executable-analysis.md §17.2). Each track plays its
 * steps in order; a step starts once the previous step of its track has started and its own
 * condition holds: at once, when a given step (track, index) has started — a Timeline step:
 * when it reaches a key time —, or when that step has finished. The sequence ends with its
 * ScriptedSequenceDone step.
 *
 * Wait, Timeline and FadeOut take their own time; PlaySound, TriggerFlag, Appear and
 * DoInteraction are instant (the scripts wait for a line's length with a Wait); the actors'
 * steps (MoveToPos, FaceRel, RunAnimation, CameraTimeline) last as long as the hooks say.
 */
export interface StepHandle {
  /** Advances the step; true once it has finished. */
  update(dtMs: number): boolean;
}

export interface SequenceHooks {
  /** A step starts (`actor`: its track's actor). Return a handle for steps that take time, else null. */
  start(step: StoryStep, index: number, actor: number): StepHandle | null;
}

/** Timeline keys every half second when a Timeline step carries none (all shipped ones do). */
const DEFAULT_KEY_MS = 500;

const ACTOR_DRIVEN = new Set(['MoveToPos', 'FaceRel', 'RunAnimation', 'CameraTimeline']);

export function stepDurationMs(step: StoryStep): number | null {
  const n = (k: string) => (typeof step.args[k] === 'number' ? (step.args[k] as number) : 0);
  switch (step.action) {
    case 'Wait':
      return Math.max(0, n('time'));
    case 'Timeline':
      return Math.max(0, n('time_total'));
    case 'FadeOut':
      return Math.max(0, n('fade_time'));
    default:
      return ACTOR_DRIVEN.has(step.action) ? null : 0;
  }
}

export class SequenceRun {
  readonly sequence: StorySequence;
  /** Milliseconds since the sequence started. */
  elapsedMs = 0;
  /** Reached its ScriptedSequenceDone (or nothing is left to run). */
  finished = false;
  /** The ScriptedSequenceDone step that ended it, if any. */
  ending: StoryStep | null = null;
  private readonly hooks: SequenceHooks;
  private readonly startedAt: (number | null)[];
  private readonly finishedAt: (number | null)[];
  private readonly handles = new Map<number, StepHandle>();
  private readonly cursor: number[];

  constructor(sequence: StorySequence, hooks: SequenceHooks) {
    this.sequence = sequence;
    this.hooks = hooks;
    this.startedAt = sequence.steps.map(() => null);
    this.finishedAt = sequence.steps.map(() => null);
    this.cursor = sequence.tracks.map(() => 0);
    this.advance();
  }

  /** Whether step `index` has started / finished. */
  started(index: number): boolean {
    return this.startedAt[index] !== null;
  }

  done(index: number): boolean {
    return this.finishedAt[index] !== null;
  }

  update(dtMs: number): void {
    if (this.finished) return;
    this.elapsedMs += dtMs;
    for (const [i, h] of this.handles) {
      if (h.update(dtMs)) {
        this.handles.delete(i);
        this.finishedAt[i] = this.elapsedMs;
      }
    }
    this.sequence.steps.forEach((s, i) => {
      if (this.startedAt[i] === null || this.finishedAt[i] !== null || this.handles.has(i)) return;
      const d = stepDurationMs(s);
      if (d !== null && this.elapsedMs - this.startedAt[i]! >= d) this.finishedAt[i] = this.startedAt[i]! + d;
    });
    this.advance();
  }

  private stepOf(track: number, index: number): number | undefined {
    return this.sequence.tracks[track]?.steps[index];
  }

  private ready(step: StoryStep): boolean {
    const w = step.when;
    if (!w || (w.event !== 0 && w.event !== 4)) return true;
    const ref = this.stepOf(w.track, w.step);
    if (ref === undefined) return true;
    if (w.event === 4) return this.finishedAt[ref] !== null;
    const at = this.startedAt[ref];
    if (at === null || at === undefined) return false;
    const refStep = this.sequence.steps[ref]!;
    if (refStep.action !== 'Timeline' || w.key === 0) return true;
    const keyMs = refStep.keys?.[w.key] ?? w.key * DEFAULT_KEY_MS;
    return this.elapsedMs - at >= keyMs;
  }

  private advance(): void {
    let progressed = true;
    while (progressed && !this.finished) {
      progressed = false;
      this.sequence.tracks.forEach((track, t) => {
        const k = this.cursor[t]!;
        if (this.finished || k >= track.steps.length) return;
        const index = track.steps[k]!;
        const step = this.sequence.steps[index];
        if (!step || !this.ready(step)) return;
        this.cursor[t] = k + 1;
        progressed = true;
        this.startedAt[index] = this.elapsedMs;
        const handle = this.hooks.start(step, index, track.actor);
        const d = stepDurationMs(step);
        if (handle && d === null) this.handles.set(index, handle);
        else if (d === 0 || (d === null && !handle)) this.finishedAt[index] = this.elapsedMs;
        if (step.action === 'ScriptedSequenceDone') {
          this.finished = true;
          this.ending = step;
        }
      });
    }
    // Nothing left to start or wait for: over.
    if (!this.finished && this.handles.size === 0 && this.sequence.tracks.every((tr, t) => this.cursor[t]! >= tr.steps.length) &&
      this.sequence.steps.every((s, i) => this.startedAt[i] === null || this.finishedAt[i] !== null)) {
      this.finished = true;
    }
  }
}

/**
 * How long a sequence plays when the actors' steps take an estimated time (moves at walking
 * speed, turns and gestures ~1-2 s): the server's upper bound for a client's cutscene.
 */
export function estimateSequenceMs(sequence: StorySequence, limitMs = 300_000): number {
  const run = new SequenceRun(sequence, {
    start(step) {
      if (stepDurationMs(step) !== null) return null;
      let left = step.action === 'MoveToPos' ? 6000 : step.action === 'RunAnimation' ? 3000 : step.action === 'CameraTimeline' ? 8000 : 1500;
      if (step.action === 'FaceRel' && step.args['neverdone'] === 1) left = Infinity;
      return { update: (dt) => (left -= dt) <= 0 };
    },
  });
  while (!run.finished && run.elapsedMs < limitMs) run.update(100);
  return run.elapsedMs;
}

/**
 * Where a sequence is staged for Drake (not original): the point another actor turns to face as
 * its first step, when the sequence does not walk Drake anywhere itself (Ws9a's Ursan looks at the
 * spot by his cell door, where the opening camera frames Drake). The original leaves the stand-in
 * where the player stood (0x41F830), off camera when the trigger was entered at its far edge.
 * Original units, Z mirrored; null when the sequence has no such spot.
 */
export function stagedPlayerSpot(sequence: StorySequence): [number, number, number] | null {
  const player = new Set(sequence.actors.flatMap((a, i) => (a && 'player' in a ? [i + SEQUENCE_ACTOR_BASE] : [])));
  if (!player.size) return null;
  for (const t of sequence.tracks) {
    if (player.has(t.actor) && t.steps.some((i) => sequence.steps[i]?.action === 'MoveToPos')) return null;
  }
  for (const t of sequence.tracks) {
    if (player.has(t.actor) || t.actor < SEQUENCE_ACTOR_BASE) continue;
    const first = sequence.steps[t.steps[0] ?? -1];
    const at = first?.args['thingtoface'];
    if (first?.action === 'FaceRel' && Array.isArray(at)) return [at[0], at[1], at[2]];
  }
  return null;
}

/**
 * Drake's facing at a staged spot (radians, 0 = -Z, the mirrored frame), where a scene asks for
 * one; null keeps his own. Ws9a's Ursan scene: he faces the wall beside the cell door.
 */
const STAGED_FACING: { spot: [number, number, number]; yaw: number }[] = [{ spot: [2098.21, 1024.093, -1643.612], yaw: 0 }];

export function stagedPlayerYaw(spot: readonly [number, number, number]): number | null {
  const f = STAGED_FACING.find((e) => Math.hypot(e.spot[0] - spot[0], e.spot[1] - spot[1], e.spot[2] - spot[2]) < 0.5);
  return f ? f.yaw : null;
}
