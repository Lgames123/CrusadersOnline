import { describe, expect, it } from 'vitest';
import {
  MAIN_QUESTS,
  QUEST_ACTION,
  QUEST_STATE,
  SequenceRun,
  applyQuestAction,
  cameraPathPoint,
  emptyQuestLog,
  estimateSequenceMs,
  inStoryVolume,
  sanitizeQuestLog,
  type StorySequence,
  type StoryStep,
} from '@crusaders/shared';

const step = (action: string, when: StoryStep['when'], args: StoryStep['args'] = {}, keys?: number[]): StoryStep => ({ action, when, args, ...(keys ? { keys } : {}) });

/**
 * Shaped like the original's first wagon scene: a 16.5 s timeline (keys every 500 ms), two lines
 * with a pause the length of the first, a fade from key 11 (5.5 s) for 3 s, and the end once
 * the fade has finished; the stand-in walks off at key 10.
 */
function wagonScene(): StorySequence {
  return {
    name: 'Seq',
    trigger: 1,
    actors: [{ player: true }, { creature: 0 }],
    tracks: [
      { actor: 2, steps: [1] },
      { actor: 2, steps: [5] },
      { actor: 2, steps: [2, 3, 4] },
      { actor: 2, steps: [0] },
      { actor: 3, steps: [6] },
    ],
    steps: [
      step('ScriptedSequenceDone', { event: 4, track: 1, step: 0, key: 0 }),
      step('Timeline', null, { time_total: 16466 }, Array.from({ length: 33 }, (_, i) => i * 500)),
      step('PlaySound', null, { sound: 1 }),
      step('Wait', { event: 4, track: 2, step: 0, key: 0 }, { time: 3317 }),
      step('PlaySound', { event: 4, track: 2, step: 1, key: 0 }, { sound: 2 }),
      step('FadeOut', { event: 0, track: 0, step: 0, key: 11 }, { fade_out: 1, fade_time: 3000 }),
      step('MoveToPos', { event: 0, track: 0, step: 0, key: 10 }, { pos: [0, 0, 10] }),
    ],
  };
}

describe('scripted sequences', () => {
  it('starts steps on their conditions and ends after the fade', () => {
    const starts = new Map<number, number>();
    let run: SequenceRun;
    run = new SequenceRun(wagonScene(), {
      start(_s, i) {
        starts.set(i, run?.elapsedMs ?? 0);
        let left = 1200; // the walk
        return _s.action === 'MoveToPos' ? { update: (dt) => (left -= dt) <= 0 } : null;
      },
    });
    while (!run.finished && run.elapsedMs < 20000) run.update(50);
    expect(starts.get(2)).toBe(0);
    expect(starts.get(3)).toBe(0);
    expect(starts.get(4)).toBe(3350); // after the 3317 ms pause, on the next 50 ms update
    expect(starts.get(6)).toBe(5000);
    expect(starts.get(5)).toBe(5500);
    expect(starts.get(0)).toBe(8500);
    expect(run.finished).toBe(true);
    expect(run.ending?.action).toBe('ScriptedSequenceDone');
  });

  it('estimates an upper bound for the server', () => {
    const ms = estimateSequenceMs(wagonScene());
    expect(ms).toBeGreaterThanOrEqual(8500);
    expect(ms).toBeLessThan(10000);
  });

  it('a step that never finishes holds up only what waits for it', () => {
    const seq: StorySequence = {
      name: 'S', trigger: 1, actors: [{ player: true }],
      tracks: [{ actor: 2, steps: [0] }, { actor: 2, steps: [1, 2] }],
      steps: [step('FaceRel', null, { neverdone: 1 }), step('Wait', null, { time: 100 }), step('ScriptedSequenceDone', { event: 4, track: 1, step: 0, key: 0 })],
    };
    const run = new SequenceRun(seq, { start: (s) => (s.action === 'FaceRel' ? { update: () => false } : null) });
    for (let i = 0; i < 5 && !run.finished; i++) run.update(50);
    expect(run.finished).toBe(true);
  });
});

describe('camera paths', () => {
  it('one segment runs from the first to the last point', () => {
    const path = { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] as [number, number, number][], segments: 1, rate: 0.001, flags: 0 };
    expect(cameraPathPoint(path, 0)[0]).toBeCloseTo(0);
    expect(cameraPathPoint(path, 0.5)[0]).toBeCloseTo(1.5);
    expect(cameraPathPoint(path, 1)[0]).toBeCloseTo(3, 2);
  });

  it('pieces join at the midpoints of the inner control points', () => {
    const path = { points: [[0, 0, 0], [0, 2, 0], [4, 2, 0], [4, 0, 0], [8, 0, 0], [8, 2, 0]] as [number, number, number][], segments: 2, rate: 0.001, flags: 0 };
    const join = cameraPathPoint(path, 0.5);
    expect(join[0]).toBeCloseTo(4);
    expect(join[1]).toBeCloseTo(1);
    expect(cameraPathPoint(path, 0.4999)[0]).toBeCloseTo(4, 2);
  });

  it('volumes test the polygon between their heights', () => {
    const v = { polygon: [[0, 0], [0, 10], [10, 10], [10, 0]] as [number, number][], yMin: 0, yMax: 20 };
    expect(inStoryVolume(v, 5, 1, 5)).toBe(true);
    expect(inStoryVolume(v, 15, 1, 5)).toBe(false);
    expect(inStoryVolume(v, 5, 30, 5)).toBe(false);
  });
});

describe('quests', () => {
  it('assigning then completing pays the reward and writes the journal', () => {
    const log = emptyQuestLog();
    const a = applyQuestAction(log, { index: 1, main: true, actions: QUEST_ACTION.ASSIGN | QUEST_ACTION.JOURNAL_START, bit: 0 });
    expect(a.assigned).toEqual([1]);
    expect(log.main[1]).toBe(QUEST_STATE.ACTIVE);
    expect(log.journal).toEqual([MAIN_QUESTS[1]!.journalStart]);
    const c = applyQuestAction(log, { index: 1, main: true, actions: QUEST_ACTION.COMPLETE, bit: 0 });
    expect(c.completed).toEqual([1]);
    expect(c.xp).toBe(MAIN_QUESTS[1]!.xp);
    expect(log.active).toEqual([]);
    expect(log.completed).toEqual([1]);
    // Again: nothing more.
    expect(applyQuestAction(log, { index: 1, main: true, actions: QUEST_ACTION.COMPLETE, bit: 0 }).xp).toBe(0);
  });

  it('a quest completed without being assigned pays nothing', () => {
    const log = emptyQuestLog();
    const c = applyQuestAction(log, { index: 0, main: true, actions: QUEST_ACTION.COMPLETE | QUEST_ACTION.JOURNAL_END, bit: 0 });
    expect(c.completed).toEqual([0]);
    expect(c.xp).toBe(0);
    expect(c.gold).toBe(0);
  });

  it('saved logs are sanitized', () => {
    const log = sanitizeQuestLog({ main: [1, 9, 3], active: [0, 99, -1], completed: [2], journal: [3151, 'x'] });
    expect(log.main.slice(0, 3)).toEqual([1, 0, 3]);
    expect(log.active).toEqual([0]);
    expect(log.journal).toEqual([3151]);
  });
});
