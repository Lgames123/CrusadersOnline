import { MAIN_QUESTS, QUEST_TEXT, type QuestLog } from '@crusaders/shared';

/**
 * The quest book (F2), as the original draws it (0x455EE0 / 0x456240): its frame of texture
 * pieces on a 640 x 480 screen over a glass pane, five tabs on the right — Next, Previous,
 * Assigned, Completed, Notes — and the page text from crusaders.exe's string table:
 * Assigned "<giver> said" / objective, Completed "Completed: <title> Quest", Notes the journal.
 * With more than one entry a page shows one, turned with Next / Previous.
 */
type Tab = 'assigned' | 'completed' | 'notes';

/** Frame pieces: texture and top-left corner on the 640 x 480 screen (0x455EE0). */
const FRAME: readonly [string, number, number][] = [
  ['questbook1', 9, 17], ['questbook2', 137, 17], ['questbook3', 265, 17], ['questbook5', 393, 0],
  ['questbook6', 512, 256], ['questbook7', 512, 384], ['questbook8', 384, 384],
  ['questbook9', 320, 418], ['questbook10', 256, 418], ['questbook11', 192, 418], ['questbook12', 128, 418], ['questbook13', 64, 418], ['questbook14', 0, 418],
];
/** Click bands of the tabs (x 520..632): Next, Previous, Assigned, Completed, Notes (0x455BF0). */
const TABS: readonly { y0: number; y1: number; action: 'next' | 'previous' | Tab; hover: number; selected?: number; texture?: string }[] = [
  { y0: 100, y1: 154, action: 'next', hover: 100 },
  { y0: 155, y1: 210, action: 'previous', hover: 156 },
  { y0: 211, y1: 268, action: 'assigned', hover: 211, selected: 212, texture: 'questbookb3' },
  { y0: 269, y1: 324, action: 'completed', hover: 270, selected: 272, texture: 'questbookb4' },
  { y0: 325, y1: 380, action: 'notes', hover: 325, selected: 328, texture: 'questbookb5' },
];

export class QuestBook {
  private readonly root: HTMLElement;
  private readonly page: HTMLElement;
  private readonly selected: HTMLImageElement;
  private readonly hover: HTMLImageElement;
  private log: QuestLog | null = null;
  private strings: ReadonlyMap<number, string> = new Map();
  private tab: Tab = 'assigned';
  private first = 0;
  onClose: () => void = () => {};
  /** Turning a page (UITurnPage, Sound.ctx 412). */
  onTurn: () => void = () => {};

  constructor(root: HTMLElement, textures: Record<string, string>) {
    this.root = root;
    const url = (t: string) => (textures[t] ? `/generated/${textures[t]}` : '');
    const screen = document.createElement('div');
    screen.className = 'qb-screen';
    const glass = document.createElement('img');
    glass.className = 'qb-glass';
    glass.src = url('glass256');
    screen.append(glass);
    for (const [t, x, y] of FRAME) {
      const img = document.createElement('img');
      img.src = url(t);
      img.style.left = `${x}px`;
      img.style.top = `${y}px`;
      screen.append(img);
    }
    this.selected = document.createElement('img');
    this.selected.style.left = '531px';
    this.hover = document.createElement('img');
    this.hover.src = url('questbookbh');
    this.hover.style.left = '545px';
    this.hover.hidden = true;
    this.page = document.createElement('div');
    this.page.className = 'qb-page';
    screen.append(this.selected, this.hover, this.page);
    root.append(screen);
    const textureOf = (tab: Tab) => url(TABS.find((t) => t.action === tab)!.texture!);
    this.selectedTexture = textureOf;
    const at = (e: MouseEvent) => {
      const r = screen.getBoundingClientRect();
      const s = r.width / 640;
      const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
      return x >= 520 && x <= 632 ? TABS.find((t) => y >= t.y0 && y <= t.y1) ?? null : null;
    };
    screen.addEventListener('mousemove', (e) => {
      const t = at(e);
      this.hover.hidden = !t;
      if (t) this.hover.style.top = `${t.hover}px`;
    });
    screen.addEventListener('mouseleave', () => (this.hover.hidden = true));
    screen.addEventListener('click', (e) => {
      const t = at(e);
      if (!t) return;
      this.onTurn();
      if (t.action === 'next') this.turn(1);
      else if (t.action === 'previous') this.turn(-1);
      else this.show(t.action);
    });
    root.addEventListener('click', (e) => e.target === root && this.onClose());
  }

  private readonly selectedTexture: (tab: Tab) => string;

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

  update(log: QuestLog): void {
    this.log = log;
    if (this.open) this.render();
  }

  show(tab: Tab): void {
    this.tab = tab;
    this.first = 0;
    this.render();
  }

  private entries(): string[] {
    const log = this.log;
    if (!log) return [];
    const s = (id: number) => this.strings.get(id) ?? '';
    if (this.tab === 'assigned') {
      return log.active.map((i) => {
        const q = MAIN_QUESTS[i];
        if (!q) return '';
        return `${q.giver ? `${s(q.giver)}${s(QUEST_TEXT.SAID)}\n` : ''}${s(q.objective)}`;
      });
    }
    if (this.tab === 'completed') {
      return log.completed.map((i) => (MAIN_QUESTS[i] ? `${s(QUEST_TEXT.COMPLETED)}${s(MAIN_QUESTS[i]!.title)}${s(QUEST_TEXT.QUEST)}` : ''));
    }
    return log.journal.map(s);
  }

  private turn(dir: number): void {
    const n = this.entries().length;
    if (n < 2) return;
    this.first = (this.first + dir + n) % n;
    this.render();
  }

  private render(): void {
    const list = this.entries().filter((e) => e);
    const tab = TABS.find((t) => t.action === this.tab)!;
    this.selected.src = this.selectedTexture(this.tab);
    this.selected.style.top = `${tab.selected}px`;
    const shown = list.length > 1 ? [list[Math.min(this.first, list.length - 1)]!] : list;
    this.page.textContent = shown.join('\n\n');
    this.page.dataset['pages'] = list.length > 1 ? `${this.first + 1} / ${list.length}` : '';
  }
}

/** The converted string table (rules/strings.json), or an empty map without the game files. */
export async function loadGameStrings(): Promise<Map<number, string>> {
  try {
    const manifest = (await (await fetch('/generated/manifest.json')).json()) as { rules?: Record<string, string> };
    const path = manifest.rules?.['strings'];
    if (!path) return new Map();
    const { strings } = (await (await fetch(`/generated/${path}`)).json()) as { strings: Record<string, string> };
    return new Map(Object.entries(strings).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map();
  }
}
