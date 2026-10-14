import { INPUT, quantizeAngle, quantizePitch, type InputFrame } from '@crusaders/shared';
import { DEFAULT_BINDINGS, VIEW_KEYS, actionFor, type Action } from './keybindings.ts';

const MOUSE_SENSITIVITY = 0.0022;
/**
 * The original's view limits and keyboard rates, measured in the running game
 * (executable-analysis.md §13): pitch ±80°, arrows turn 200°/s, numpad looks 150°/s.
 */
const DEG = Math.PI / 180;
const PITCH_MIN = -80 * DEG;
const PITCH_MAX = 80 * DEG;
const TURN_RATE = 200 * DEG;
const LOOK_RATE = 150 * DEG;

/**
 * Samples keyboard/mouse into fixed-step input frames. Key presses shorter than one
 * tick (e.g. a tapped jump) are latched so they are never lost between samples.
 */
export class InputManager {
  /** Camera yaw/pitch, radians. Yaw 0 faces -Z. */
  yaw = 0;
  pitch = 0;
  locked = false;
  /** Mouse sensitivity multiplier and vertical inversion (player settings). */
  sensitivity = 1;
  invertY = false;

  private held = 0;
  private latched = 0;
  private readonly bindings = DEFAULT_BINDINGS;
  onLockChange: (locked: boolean) => void = () => {};
  /** Primary mouse button while the pointer is locked. The secondary button holds BLOCK. */
  onAttack: () => void = () => {};
  /** One-shot action keys (interact, potion...) while the pointer is locked. */
  onAction: (action: Action) => void = () => {};
  private readonly view = new Set<string>();

  private readonly element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
    const viewCodes = new Set<string>(Object.values(VIEW_KEYS).flat());
    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      const flag = this.bindings[e.code];
      if (flag !== undefined) {
        e.preventDefault();
        // C pressed while a direction is held: roll that way (original controls).
        if (flag === INPUT.DUCK && !e.repeat && this.held & (INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT)) this.latched |= INPUT.ROLL;
        this.held |= flag;
        this.latched |= flag;
      }
      if (viewCodes.has(e.code)) {
        e.preventDefault();
        this.view.add(e.code);
      }
      const action = actionFor(e.code);
      if (action) {
        e.preventDefault();
        if (!e.repeat) this.onAction(action);
      }
    });
    window.addEventListener('keyup', (e) => {
      const flag = this.bindings[e.code];
      if (flag !== undefined) this.held &= ~flag;
      this.view.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.held = 0;
      this.view.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const k = MOUSE_SENSITIVITY * this.sensitivity;
      this.yaw -= e.movementX * k;
      this.setPitch(this.pitch - (this.invertY ? -1 : 1) * e.movementY * k);
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.onAttack();
      else if (e.button === 2) this.held |= INPUT.BLOCK;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.held &= ~INPUT.BLOCK;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.held = 0;
        this.view.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  /** Asks for pointer lock; the browser may refuse (no user gesture, just left with Esc): a click retries. */
  requestLock(): void {
    try {
      Promise.resolve(this.element.requestPointerLock()).catch(() => {});
    } catch {
      // Older engines throw instead of rejecting.
    }
  }

  private setPitch(p: number): void {
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));
  }

  private viewHeld(keys: readonly string[]): boolean {
    return keys.some((k) => this.view.has(k));
  }

  /** Keyboard turning and looking (arrows, numpad), once per rendered frame. */
  updateView(dt: number): void {
    if (!this.view.size) return;
    if (this.viewHeld(VIEW_KEYS.turnLeft)) this.yaw += TURN_RATE * dt;
    if (this.viewHeld(VIEW_KEYS.turnRight)) this.yaw -= TURN_RATE * dt;
    if (this.viewHeld(VIEW_KEYS.lookUp)) this.setPitch(this.pitch + LOOK_RATE * dt);
    if (this.viewHeld(VIEW_KEYS.lookDown)) this.setPitch(this.pitch - LOOK_RATE * dt);
    if (this.viewHeld(VIEW_KEYS.lookCentre)) this.pitch = 0;
  }

  /** Movement flags currently held (attack selection reads them at click time). */
  get heldFlags(): number {
    return this.held;
  }

  /** Fills `out` with the input for the next fixed step. */
  sample(out: InputFrame, clientTick: number): void {
    out.clientTick = clientTick;
    out.flags = this.held | (this.latched & (INPUT.JUMP | INPUT.ROLL));
    out.yaw = quantizeAngle(this.yaw);
    out.pitch = quantizePitch(this.pitch);
    this.latched = 0;
  }
}
