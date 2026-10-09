import { INPUT } from '@crusaders/shared';

/** KeyboardEvent.code -> input flag. Layout-independent (WASD stays put on AZERTY). */
export const DEFAULT_BINDINGS: Readonly<Record<string, number>> = {
  KeyW: INPUT.FORWARD,
  ArrowUp: INPUT.FORWARD,
  KeyS: INPUT.BACK,
  ArrowDown: INPUT.BACK,
  KeyA: INPUT.LEFT,
  ArrowLeft: INPUT.LEFT,
  KeyD: INPUT.RIGHT,
  ArrowRight: INPUT.RIGHT,
  Space: INPUT.JUMP,
  ShiftLeft: INPUT.WALK,
  ShiftRight: INPUT.WALK,
};
