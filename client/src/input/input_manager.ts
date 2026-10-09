import { INPUT, quantizeAngle, quantizePitch, type InputFrame } from '@crusaders/shared';
import { DEFAULT_BINDINGS } from './keybindings.ts';

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_MIN = -1.2;
const PITCH_MAX = 0.6;

/**
 * Samples keyboard/mouse into fixed-step input frames. Key presses shorter than one
 * tick (e.g. a tapped jump) are latched so they are never lost between samples.
 */
export class InputManager {
  /** Camera yaw/pitch, radians. Yaw 0 faces -Z. */
  yaw = 0;
  pitch = -0.3;
  locked = false;

  private held = 0;
  private latched = 0;
  private readonly bindings = DEFAULT_BINDINGS;
  onLockChange: (locked: boolean) => void = () => {};

  private readonly element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', (e) => {
      const flag = this.bindings[e.code];
      if (flag === undefined || !this.locked) return;
      e.preventDefault();
      this.held |= flag;
      this.latched |= flag;
    });
    window.addEventListener('keyup', (e) => {
      const flag = this.bindings[e.code];
      if (flag !== undefined) this.held &= ~flag;
    });
    window.addEventListener('blur', () => (this.held = 0));
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch - e.movementY * MOUSE_SENSITIVITY));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.held = 0;
      this.onLockChange(this.locked);
    });
  }

  requestLock(): void {
    void this.element.requestPointerLock();
  }

  /** Fills `out` with the input for the next fixed step. */
  sample(out: InputFrame, clientTick: number): void {
    out.clientTick = clientTick;
    out.flags = this.held | (this.latched & INPUT.JUMP);
    out.yaw = quantizeAngle(this.yaw);
    out.pitch = quantizePitch(this.pitch);
    this.latched = 0;
  }
}
