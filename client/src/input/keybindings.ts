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

export type ViewKeyAction = keyof typeof VIEW_KEYS;

/** One-shot actions. Reserved ones are listed so nothing else takes their keys. */
export const ACTION_KEYS = {
  attack: ['Mouse0'],
  block: ['Mouse2'],
  interact: ['Tab'],
  healthPotion: ['KeyH'],
  inventory: ['KeyI'],
  characterSheet: ['F1'],
  questBook: ['F2'],
  // Original R cast / T cycle spell (unchanged by the WASD shift).
  nextSpell: ['KeyT'],
  castSpell: ['KeyR'],
  // Original "use item" (Z after the WASD shift): unlocks a door with its key, else a potion.
  useItem: ['KeyZ'],
  // The area map (the original's map key, unused there).
  map: ['KeyM'],
  // Reserved (systems not implemented yet): original bindings after the WASD shift.
  nextItem: ['KeyQ'],
  nextWeapon: ['KeyE'],
  quickSelect: ['KeyX'],
} as const;

export type Action = keyof typeof ACTION_KEYS;

export type BindingCategory = 'movement' | 'combat' | 'actions' | 'view' | 'hotbar';

export interface BindingDefinition {
  id: string;
  label: string;
  category: BindingCategory;
  defaultKeys: string[];
  flag?: number;
  action?: Action;
  view?: ViewKeyAction;
  /** Hotbar slot (0-8 the first row, 9-17 the second). */
  hotbar?: number;
}

/** Slots per hotbar row, and rows. */
export const HOTBAR_COLUMNS = 9;
export const HOTBAR_ROWS = 2;

/** A key pressed with Shift held is bound as `Shift+<code>` (hotbar row 2 defaults). */
export const SHIFT_PREFIX = 'Shift+';

/** The code a key event binds as: `Shift+Digit1` with Shift held (Shift itself stays plain). */
export function comboCode(e: { code: string; shiftKey: boolean }): string {
  return e.shiftKey && !e.code.startsWith('Shift') ? SHIFT_PREFIX + e.code : e.code;
}

/** Not original (the original has no hotbar): row 1 on 1-9, row 2 on Shift+1-9. */
const HOTBAR_DEFINITIONS: BindingDefinition[] = Array.from({ length: HOTBAR_COLUMNS * HOTBAR_ROWS }, (_, i) => {
  const row = Math.floor(i / HOTBAR_COLUMNS), col = i % HOTBAR_COLUMNS;
  return { id: `hotbar${i + 1}`, label: `Hotbar ${row + 1} · Slot ${col + 1}`, category: 'hotbar', defaultKeys: [`${row ? SHIFT_PREFIX : ''}Digit${col + 1}`], hotbar: i };
});

export const BINDING_DEFINITIONS: readonly BindingDefinition[] = [
  // Movement
  { id: 'forward', label: 'Move Forward', category: 'movement', defaultKeys: ['KeyW', 'ArrowUp'], flag: INPUT.FORWARD },
  { id: 'back', label: 'Move Backward', category: 'movement', defaultKeys: ['KeyS', 'ArrowDown'], flag: INPUT.BACK },
  { id: 'left', label: 'Strafe Left', category: 'movement', defaultKeys: ['KeyA', 'Numpad1'], flag: INPUT.LEFT },
  { id: 'right', label: 'Strafe Right', category: 'movement', defaultKeys: ['KeyD', 'Numpad3'], flag: INPUT.RIGHT },
  { id: 'jump', label: 'Jump', category: 'movement', defaultKeys: ['Space'], flag: INPUT.JUMP },
  { id: 'duck', label: 'Duck / Roll', category: 'movement', defaultKeys: ['KeyC'], flag: INPUT.DUCK },
  { id: 'walk', label: 'Walk (Slow)', category: 'movement', defaultKeys: ['ShiftLeft', 'ShiftRight'], flag: INPUT.WALK },

  // Combat
  { id: 'attack', label: 'Attack (Combo)', category: 'combat', defaultKeys: ['Mouse0'], action: 'attack' },
  { id: 'block', label: 'Block / Shield', category: 'combat', defaultKeys: ['Mouse2'], flag: INPUT.BLOCK, action: 'block' },
  { id: 'castSpell', label: 'Cast Spell', category: 'combat', defaultKeys: ['KeyR'], action: 'castSpell' },
  { id: 'nextSpell', label: 'Cycle Spell', category: 'combat', defaultKeys: ['KeyT'], action: 'nextSpell' },
  { id: 'healthPotion', label: 'Health Potion', category: 'combat', defaultKeys: ['KeyH'], action: 'healthPotion' },
  { id: 'useItem', label: 'Use Key / Potion', category: 'combat', defaultKeys: ['KeyZ'], action: 'useItem' },

  // Actions & Interface
  { id: 'interact', label: 'Interact / Open / Talk', category: 'actions', defaultKeys: ['Tab'], action: 'interact' },
  { id: 'inventory', label: 'Toggle Inventory', category: 'actions', defaultKeys: ['KeyI'], action: 'inventory' },
  { id: 'characterSheet', label: 'Toggle Character Statistics', category: 'actions', defaultKeys: ['F1'], action: 'characterSheet' },
  { id: 'questBook', label: 'Toggle Quest Book', category: 'actions', defaultKeys: ['F2'], action: 'questBook' },
  { id: 'map', label: 'Toggle Area Map', category: 'actions', defaultKeys: ['KeyM'], action: 'map' },

  // Camera / View
  { id: 'turnLeft', label: 'Turn Left', category: 'view', defaultKeys: ['ArrowLeft', 'Numpad4'], view: 'turnLeft' },
  { id: 'turnRight', label: 'Turn Right', category: 'view', defaultKeys: ['ArrowRight', 'Numpad6'], view: 'turnRight' },
  { id: 'lookUp', label: 'Look Up', category: 'view', defaultKeys: ['Numpad9'], view: 'lookUp' },
  { id: 'lookDown', label: 'Look Down', category: 'view', defaultKeys: ['Numpad7'], view: 'lookDown' },
  { id: 'lookCentre', label: 'Center View', category: 'view', defaultKeys: ['Numpad5'], view: 'lookCentre' },

  // Hotbar
  ...HOTBAR_DEFINITIONS,
];

export function getDefaultKeybindings(): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  for (const def of BINDING_DEFINITIONS) res[def.id] = [...def.defaultKeys];
  return res;
}

export function formatKeyCode(code: string): string {
  if (!code) return '—';
  if (code.startsWith(SHIFT_PREFIX)) return `Shift+${formatKeyCode(code.slice(SHIFT_PREFIX.length))}`;
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  switch (code) {
    case 'Space': return 'Space';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case 'ShiftLeft': return 'L-Shift';
    case 'ShiftRight': return 'R-Shift';
    case 'ControlLeft': return 'L-Ctrl';
    case 'ControlRight': return 'R-Ctrl';
    case 'AltLeft': return 'L-Alt';
    case 'AltRight': return 'R-Alt';
    case 'Tab': return 'Tab';
    case 'Enter': return 'Enter';
    case 'Backspace': return 'Bksp';
    case 'Delete': return 'Del';
    case 'Mouse0': return 'Left Click';
    case 'Mouse1': return 'Middle Click';
    case 'Mouse2': return 'Right Click';
    case 'Mouse3': return 'Mouse 4';
    case 'Mouse4': return 'Mouse 5';
    default: return code;
  }
}

export interface CompiledBindings {
  bindings: Record<string, number>;
  viewKeys: Record<ViewKeyAction, string[]>;
  actionFor: (code: string) => Action | null;
  isAction: (action: Action, code: string) => boolean;
  /** The hotbar slot a (combo) code uses, or null. */
  hotbarFor: (code: string) => number | null;
  /** Each hotbar slot's first key, for the slot labels. */
  hotbarKeys: string[];
}

export function compileBindings(custom?: Record<string, string[]>): CompiledBindings {
  const current: Record<string, string[]> = { ...getDefaultKeybindings(), ...(custom ?? {}) };
  const bindings: Record<string, number> = {};
  const viewKeys: Record<ViewKeyAction, string[]> = {
    turnLeft: [],
    turnRight: [],
    lookUp: [],
    lookDown: [],
    lookCentre: [],
  };
  const actionToCodes = new Map<Action, string[]>();
  const codeToAction = new Map<string, Action>();
  const codeToHotbar = new Map<string, number>();
  const hotbarKeys: string[] = [];

  for (const def of BINDING_DEFINITIONS) {
    const keys = current[def.id] ?? def.defaultKeys;
    if (def.flag !== undefined) {
      for (const k of keys) {
        if (!k.startsWith('Mouse')) bindings[k] = (bindings[k] ?? 0) | def.flag;
      }
    }
    if (def.view) {
      viewKeys[def.view] = [...keys];
    }
    if (def.action) {
      actionToCodes.set(def.action, [...keys]);
      for (const k of keys) codeToAction.set(k, def.action);
    }
    if (def.hotbar !== undefined) {
      hotbarKeys[def.hotbar] = keys[0] ?? '';
      for (const k of keys) codeToHotbar.set(k, def.hotbar);
    }
  }

  return {
    bindings,
    viewKeys,
    actionFor: (code: string) => codeToAction.get(code) ?? null,
    isAction: (action: Action, code: string) => actionToCodes.get(action)?.includes(code) ?? false,
    hotbarFor: (code: string) => codeToHotbar.get(code) ?? null,
    hotbarKeys,
  };
}

export function actionFor(code: string): Action | null {
  for (const [action, keys] of Object.entries(ACTION_KEYS) as [Action, readonly string[]][]) {
    if (keys.includes(code)) return action;
  }
  return null;
}

/** Help line shown in the options menu. */
export const CONTROLS_HELP =
  'WASD move · Mouse look · Wheel camera distance · Space jump · Click attack · Right click block · ' +
  'R cast spell · T next spell · Tab interact / open · Z use item · H potion · I inventory · 1-9 / Shift+1-9 hotbar · F1 statistics · F2 quest log · M map · Esc options';
