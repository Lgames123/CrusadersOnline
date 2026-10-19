import { INPUT, quantizeAngle, quantizePitch, type InputFrame } from '@crusaders/shared';
import { comboCode, compileBindings, type Action, type CompiledBindings } from './keybindings.ts';

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
  private compiled: CompiledBindings = compileBindings();
  private viewCodes = new Set<string>();

  onLockChange: (locked: boolean) => void = () => {};
  /** Primary mouse button while the pointer is locked. The secondary button holds BLOCK. */
  onAttack: () => void = () => {};
  /** The attack button (or key) is held: the original keeps attacking while it is. */
  attackHeld = false;
  /** One-shot action keys (interact, potion...) while the pointer is locked. */
  onAction: (action: Action) => void = () => {};
  /** The game is in play (no menu, window, chat line or sequence): the pointer should be locked. */
  wantsLock: () => boolean = () => false;
  private retryTimer = 0;
  /** A hotbar key (also with the cursor free, outside text fields); the slot index. */
  onHotbar: (slot: number) => void = () => {};
  private readonly view = new Set<string>();

  private readonly element: HTMLElement;

  constructor(element: HTMLElement, initialKeybindings?: Record<string, string[]>) {
    this.element = element;
    this.setBindings(initialKeybindings);

    window.addEventListener('keydown', (e) => {
      const slot = this.hotbarSlot(e);
      if (slot !== null) {
        const t = e.target as HTMLElement | null;
        const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || !!t?.isContentEditable;
        if (!typing) {
          if (this.locked) e.preventDefault();
          if (!e.repeat) this.onHotbar(slot);
        }
      }
      if (!this.locked) {
        // In play without the pointer (the browser refused it): any key is the gesture that takes it.
        const t = e.target as HTMLElement | null;
        const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || !!t?.isContentEditable;
        if (!typing && e.code !== 'Escape' && this.wantsLock()) this.requestLock();
        return;
      }
      const flag = this.compiled.bindings[e.code];
      if (flag !== undefined) {
        e.preventDefault();
        // C pressed while a direction is held: roll that way (original controls).
        if (flag === INPUT.DUCK && !e.repeat && this.held & (INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT)) this.latched |= INPUT.ROLL;
        this.held |= flag;
        this.latched |= flag;
      }
      if (this.viewCodes.has(e.code)) {
        e.preventDefault();
        this.view.add(e.code);
      }
      const action = this.compiled.actionFor(e.code);
      if (action) {
        e.preventDefault();
        if (action === 'attack' && !e.repeat) {
          this.attackHeld = true;
          this.onAttack();
        }
        else if (action === 'block') this.held |= INPUT.BLOCK;
        else if (!e.repeat) this.onAction(action);
      }
    });

    window.addEventListener('keyup', (e) => {
      const flag = this.compiled.bindings[e.code];
      if (flag !== undefined) this.held &= ~flag;
      this.view.delete(e.code);
      const action = this.compiled.actionFor(e.code);
      if (action === 'block') this.held &= ~INPUT.BLOCK;
      if (action === 'attack') this.attackHeld = false;
    });

    window.addEventListener('blur', () => {
      this.held = 0;
      this.attackHeld = false;
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
      const mouseCode = `Mouse${e.button}`;
      if (this.compiled.isAction('attack', mouseCode) || (e.button === 0 && !this.compiled.actionFor('Mouse0'))) {
        this.attackHeld = true;
        this.onAttack();
      }
      if (this.compiled.isAction('block', mouseCode) || (e.button === 2 && !this.compiled.actionFor('Mouse2'))) {
        this.held |= INPUT.BLOCK;
      }
    });

    document.addEventListener('mouseup', (e) => {
      const mouseCode = `Mouse${e.button}`;
      if (this.compiled.isAction('attack', mouseCode) || (e.button === 0 && !this.compiled.actionFor('Mouse0'))) this.attackHeld = false;
      if (this.compiled.isAction('block', mouseCode) || (e.button === 2 && !this.compiled.actionFor('Mouse2'))) {
        this.held &= ~INPUT.BLOCK;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.held = 0;
        this.attackHeld = false;
        this.view.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  /** Apply custom keybindings dynamically. */
  setBindings(custom?: Record<string, string[]>): void {
    this.compiled = compileBindings(custom);
    this.viewCodes = new Set<string>(Object.values(this.compiled.viewKeys).flat());
  }

  /** The hotbar slot of a key event: its Shift combo first, else the plain key (1 still works while walking). */
  hotbarSlot(e: { code: string; shiftKey: boolean }): number | null {
    return this.compiled.hotbarFor(comboCode(e)) ?? this.compiled.hotbarFor(e.code);
  }

  /** Each hotbar slot's first key code. */
  get hotbarKeys(): readonly string[] {
    return this.compiled.hotbarKeys;
  }

  /** Check if a key code triggers a specific action (used for menus outside pointer lock). */
  isKeyForAction(action: Action, code: string): boolean {
    return this.compiled.isAction(action, code);
  }

  /** The key is bound to a movement flag, a view key or an action. */
  isBound(code: string): boolean {
    return this.compiled.bindings[code] !== undefined || this.viewCodes.has(code) || this.compiled.actionFor(code) !== null || this.compiled.hotbarFor(code) !== null;
  }

  /** The key is bound to walking (forward, back, strafe). */
  isMoveKey(code: string): boolean {
    const flag = this.compiled.bindings[code];
    return flag !== undefined && (flag & (INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT)) !== 0;
  }

  /** Holds a movement key pressed while the pointer was free (its keyup lets go as usual). */
  pressMove(code: string): void {
    if (this.isMoveKey(code)) this.held |= this.compiled.bindings[code]!;
  }

  /**
   * Asks for pointer lock. The browser refuses it for about a second after the player left it
   * with Esc (Chrome): it is asked again while the game still wants it, inside the gesture's
   * activation window; past that, any key or click takes it.
   */
  requestLock(tries = 8): void {
    window.clearTimeout(this.retryTimer);
    const retry = () => {
      if (tries > 1 && !this.locked) this.retryTimer = window.setTimeout(() => {
        if (!this.locked && this.wantsLock()) this.requestLock(tries - 1);
      }, 300);
    };
    try {
      Promise.resolve(this.element.requestPointerLock()).catch(retry);
    } catch {
      // Older engines throw instead of rejecting.
      retry();
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
    if (this.viewHeld(this.compiled.viewKeys.turnLeft)) this.yaw += TURN_RATE * dt;
    if (this.viewHeld(this.compiled.viewKeys.turnRight)) this.yaw -= TURN_RATE * dt;
    if (this.viewHeld(this.compiled.viewKeys.lookUp)) this.setPitch(this.pitch + LOOK_RATE * dt);
    if (this.viewHeld(this.compiled.viewKeys.lookDown)) this.setPitch(this.pitch - LOOK_RATE * dt);
    if (this.viewHeld(this.compiled.viewKeys.lookCentre)) this.pitch = 0;
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
