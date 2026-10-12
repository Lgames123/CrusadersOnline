import { INPUT } from '@crusaders/shared';

/**
 * The original game's controls (its Readme), moved from ESDF to WASD: E/D/S/F become
 * W/S/A/D, and original keys displaced by that shift move to the nearest free key
 * (next weapon W -> E, quick select A -> X). Everything else keeps its original key.
 * KeyboardEvent.code values, so the layout is positional (WASD stays put on AZERTY).
 */

/** Keys that set a movement flag while held. */
export const DEFAULT_BINDINGS: Readonly<Record<string, number>> = {
  KeyW: INPUT.FORWARD,
  ArrowUp: INPUT.FORWARD,
  Numpad8: INPUT.FORWARD,
  KeyS: INPUT.BACK,
  ArrowDown: INPUT.BACK,
  Numpad2: INPUT.BACK,
  KeyA: INPUT.LEFT,
  Numpad1: INPUT.LEFT,
  KeyD: INPUT.RIGHT,
  Numpad3: INPUT.RIGHT,
  Space: INPUT.JUMP,
  ShiftLeft: INPUT.WALK,
  ShiftRight: INPUT.WALK,
  // C held ducks; pressed with a direction it rolls (input manager latches INPUT.ROLL).
  KeyC: INPUT.DUCK,
};

/** Keys that turn or tilt the view (handled by the input manager, not sent as flags). */
export const VIEW_KEYS = {
  turnLeft: ['ArrowLeft', 'Numpad4'],
  turnRight: ['ArrowRight', 'Numpad6'],
  lookUp: ['Numpad9'],
  lookDown: ['Numpad7'],
  lookCentre: ['Numpad5'],
} as const;

/** One-shot actions. Reserved ones are listed so nothing else takes their keys. */
export const ACTION_KEYS = {
  interact: ['Tab'],
  healthPotion: ['KeyH'],
  inventory: ['KeyI'],
  // Original R cast / T cycle spell (unchanged by the WASD shift).
  nextSpell: ['KeyT'],
  castSpell: ['KeyR'],
  // Reserved (systems not implemented yet): original bindings after the WASD shift.
  useItem: ['KeyZ'],
  nextItem: ['KeyQ'],
  nextWeapon: ['KeyE'],
  quickSelect: ['KeyX'],
  map: ['KeyM'],
} as const;

export type Action = keyof typeof ACTION_KEYS;

export function actionFor(code: string): Action | null {
  for (const [action, keys] of Object.entries(ACTION_KEYS) as [Action, readonly string[]][]) {
    if (keys.includes(code)) return action;
  }
  return null;
}

/** Help line shown on the "click to play" screen. */
export const CONTROLS_HELP =
  'WASD move · Mouse look · Wheel camera distance · ←/→ turn · Numpad 9/7/5 look up/down/centre · ' +
  'Click attack (5-hit combo; W or Space + click: leaping attack; A / D + click: side swings) · Right click block (+ Space: shield rush) · ' +
  'Space jump · C duck (C + direction: roll) · Shift walk · R cast spell · T next spell · Tab pick up / open · H health potion · I inventory · Esc release mouse';
