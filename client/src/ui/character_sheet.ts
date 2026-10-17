import { xpForLevel, type PlayerStats } from '@crusaders/shared';

/**
 * The character statistics screen (F1), as the original draws it (0x454CA0, textures loaded by
 * 0x454C10): the glass pane stretched over (8,12)-(629,472) of a 640 x 480 screen, statsB's hook
 * at (0,4), statsA's corner at (512,0), statsC's 16-pixel bar tiled along the top (y 7) and,
 * turned a quarter, down the right (x 614). Its text boxes (0x4414F0: x, y, width, lines, colour
 * 0xCFCFCF) hold the exe's strings: name, level, experience and the four attributes; damage
 * multiplier, mana and health; and the Type / Resist / Damage table. No mouse handling (its
 * vtable's mouse slots are empty).
 */

/** String-table ids (LoadStringA). */
const S = {
  EXPERIENCE: 2957, NEXT_LEVEL: 2958, LEVEL: 2959,
  MIGHT: 2960, INTELLIGENCE: 2961, ENDURANCE: 2962, SPEED: 2963,
  DAMAGE_MULTIPLIER: 2964, MANA: 2965, HEALTH: 2966,
  TYPE: 2967, RESIST: 2968, DAMAGE: 2969,
  /** Slash ... Dark, in DAMAGE_TYPES order. */
  FIRST_DAMAGE_TYPE: 2970,
  TOTAL: 2981,
} as const;
/** Damage types the table leaves out: Mind, Spirit, Body (offsets 0x1C, 0x20, 0x24). */
const HIDDEN_TYPES = new Set([6, 7, 8]);

/** Text boxes: left, top, width (screen pixels). */
const BOXES: readonly [number, number, number][] = [
  [128, 48, 384], // name, experience, attributes
  [338, 122, 300], // damage multiplier, mana, health
  [160, 210, 352], // Type
  [260, 210, 352], // Resist
  [360, 210, 352], // Damage
];

const f32 = Math.fround;
/** printf "%.Nf" on a float. */
const fixed = (v: number, n: number) => v.toFixed(n);

export class CharacterSheet {
  private readonly root: HTMLElement;
  private readonly boxes: HTMLElement[];
  private stats: PlayerStats | null = null;
  private strings: ReadonlyMap<number, string> = new Map();
  onClose: () => void = () => {};

  constructor(root: HTMLElement, textures: Record<string, string>) {
    this.root = root;
    const url = (t: string) => (textures[t] ? `/generated/${textures[t]}` : '');
    const screen = document.createElement('div');
    screen.className = 'cs-screen';
    const img = (t: string, x: number, y: number, cls?: string) => {
      const i = document.createElement('img');
      i.src = url(t);
      i.style.left = `${x}px`;
      i.style.top = `${y}px`;
      if (cls) i.className = cls;
      screen.append(i);
    };
    img('glass256', 8, 12, 'cs-glass');
    for (let x = 0; x < 0x1f0; x += 16) img('statsc', x + 24, 7);
    for (let i = 0, y = 120; i < 22; i++, y += 16) img('statsc', 614, y, 'cs-bar-right');
    img('statsa', 512, 0);
    img('statsb', 0, 4);
    this.boxes = BOXES.map(([x, y, w]) => {
      const box = document.createElement('div');
      box.className = 'cs-text';
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      screen.append(box);
      return box;
    });
    root.append(screen);
    root.addEventListener('click', (e) => e.target === root && this.onClose());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  set open(v: boolean) {
    this.root.hidden = !v;
    if (v) this.render();
  }

  setStrings(strings: ReadonlyMap<number, string>): void {
    this.strings = strings;
    if (this.open) this.render();
  }

  update(stats: PlayerStats): void {
    this.stats = stats;
    if (this.open) this.render();
  }

  private render(): void {
    const st = this.stats;
    if (!st) return;
    const s = (id: number) => this.strings.get(id) ?? '';
    const a = st.attributes;
    // "Drake the Crusader  " in the original: each player's own name here.
    this.boxes[0]!.textContent =
      `${st.name} the Crusader  ${s(S.LEVEL)} ${st.level}\n\n` +
      ` ${s(S.EXPERIENCE)} ${st.xp}  ${s(S.NEXT_LEVEL)} ${xpForLevel(st.level + 1)}\n\n` +
      ` ${a.might} ${s(S.MIGHT)}\n ${a.intellect} ${s(S.INTELLIGENCE)}\n ${a.endurance} ${s(S.ENDURANCE)}\n ${a.speed} ${s(S.SPEED)}\n\n`;
    this.boxes[1]!.textContent =
      `${s(S.DAMAGE_MULTIPLIER)} ${fixed(st.damageMultiplier, 1)}\n` +
      `${s(S.MANA)} ${st.mana}/${st.maxMana}\n` +
      `${s(S.HEALTH)} ${Math.round(st.hp)}/${st.maxHp}\n`;
    // The table: name, resist % (truncated, 1 - multiplier), the weapon's damage (truncated).
    let type = `${s(S.TYPE)}\n`, resist = `${s(S.RESIST)}\n`, damage = `${s(S.DAMAGE)}\n`;
    let total = 0;
    for (let t = 0; t < 11; t++) total = f32(total + f32(st.damage[t] ?? 0));
    for (let t = 0; t < 11; t++) {
      if (HIDDEN_TYPES.has(t)) continue;
      type += `${s(S.FIRST_DAMAGE_TYPE + t)}\n`;
      resist += ` ${Math.trunc(f32(f32(1 - f32(st.resist[t] ?? 1)) * 100))}%\n`;
      damage += `  ${Math.trunc(f32(st.damage[t] ?? 0))}\n`;
    }
    type += s(S.TOTAL);
    resist += '      ';
    const mult = f32(st.damageMultiplier);
    damage += `  ${fixed(total, 0)} x ${fixed(mult, 1)} = ${fixed(f32(total * mult), 0)}`;
    this.boxes[2]!.textContent = type;
    this.boxes[3]!.textContent = resist;
    this.boxes[4]!.textContent = damage;
  }
}
