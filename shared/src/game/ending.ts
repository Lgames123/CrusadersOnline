/**
 * The game's ending (executable-analysis.md §24). Necros's death (0x0044C6A0, creature type 0x96)
 * runs 0x0044F7B0: a timeline of camera shots around his body, slow motion, a fade to white, and at
 * 10.5 s the load of act CS5B, where Seq24 (Aerin, Prince Dain and Tamris) closes the story and
 * its ScriptedSequenceDone loads exit "end".
 *
 * Not original (an MMO adaptation): every player who hurt Necros gets the ending, and after Seq24
 * the character stays in Cs5b with the story marked complete (StoryState.completedAt), which opens
 * every story-gated door for him.
 */

/** Necros's act (the battleship): it has no exits, so a finished character there is sent to the ending act. */
export const NECROS_ACT = 'bs1a';
/** The act the ending loads (0x0044F7B0's string at 0x004EEECC, "CS5B"). */
export const ENDING_ACT = 'cs5b';
/** Seconds from Necros's death to the load of the ending act. */
export const ENDING_LOAD_SECONDS = 10.5;
/** The scripted exit that ends the game (Seq24's ScriptedSequenceDone). */
export const ENDING_EXIT = 'end';

/**
 * The death timeline (0x0044F7B0), in seconds from the death. Each shot is a fixed camera:
 * its target 4 ft above and 2 ft ahead of Necros (his local (0, 4, 2), vtable +0xF8), its eye
 * `distance` ft from the target along the world axes (sin `angle` on x, cos on z: not turned
 * with Necros), `rise` ft higher. The game's time scale is set to `timeScale[0].scale` at once
 * (0x004C6560 on the clock), then changed at each later entry. The screen fades to white at
 * `fadeOut` over `fadeOutSeconds` (FADE event, colour 255, 255, 255).
 */
export const NECROS_DEATH = {
  shots: [
    { at: 0, angle: Math.PI / 3, distance: 10, rise: 0 },
    { at: 7 / 6, angle: -Math.PI / 3, distance: 10, rise: 0 },
    { at: 7 / 3, angle: 0, distance: 10, rise: 0 },
    { at: 3.5, angle: 0, distance: 10, rise: 10 },
  ],
  /** The shots' target, in Necros's frame (ft: right, up, forward). */
  target: [0, 4, 2] as const,
  timeScale: [
    { at: 0, scale: 0.1 },
    { at: 3.5, scale: 0.5 },
    { at: 11.5, scale: 1 },
  ],
  fadeOut: 7.5,
  fadeOutSeconds: 3,
  /** The fade back in at the load (FADE mode 0), over this long. */
  fadeInSeconds: 2,
} as const;

/** The time scale of the death timeline at `t` seconds. */
export function necrosDeathTimeScale(t: number): number {
  let scale: number = NECROS_DEATH.timeScale[0].scale;
  for (const k of NECROS_DEATH.timeScale) if (t >= k.at) scale = k.scale;
  return scale;
}

/** The shot of the death timeline at `t` seconds. */
export function necrosDeathShot(t: number): (typeof NECROS_DEATH.shots)[number] {
  let shot: (typeof NECROS_DEATH.shots)[number] = NECROS_DEATH.shots[0];
  for (const s of NECROS_DEATH.shots) if (t >= s.at) shot = s;
  return shot;
}
