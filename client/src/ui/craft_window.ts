import { BUILTIN_ITEMS, RECIPES, SALVAGE, moddable, modsTitle, skillLevel, skillXpFor, type InventoryItemView, type PlayerStats } from '@crusaders/shared';

/**
 * Smithing and salvaging at a merchant (MMO Stage 6, not original): the player's skill levels,
 * the recipes with what they take, and the gear in the bag with what it breaks into.
 */
const STYLE = `
#craft-window { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 13; width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
  padding: 14px 16px; border: 2px solid #8a6d32; border-radius: 6px; background: rgba(14,12,9,.96); color: #f0e6cc; font: 13px/1.35 Georgia, serif; box-shadow: 0 12px 40px rgba(0,0,0,.8); }
#craft-window[hidden] { display: none; }
#craft-window h2 { margin: 0 0 6px; font-size: 18px; font-weight: normal; color: #f1d58e; }
#craft-window .cw-close { position: absolute; right: 10px; top: 6px; background: none; border: 0; color: #d8c69a; font-size: 22px; cursor: pointer; }
#craft-window .cw-skills { color: #a9c7e8; margin-bottom: 8px; }
#craft-window .cw-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
#craft-window .cw-tab { padding: 5px 12px; border: 1px solid #5d4a23; border-radius: 3px; background: rgba(30,24,14,.8); color: #d8c69a; font: inherit; cursor: pointer; }
#craft-window .cw-tab[aria-selected="true"] { border-color: #8fd0ff; color: #fff; background: rgba(30,60,100,.75); }
#craft-window .cw-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 6px 8px; border-bottom: 1px solid #2e261a; }
#craft-window .cw-row small { display: block; color: #a9b2c0; }
#craft-window .cw-row.cw-locked { opacity: .55; }
#craft-window .cw-list { max-height: 55vh; overflow: auto; }
#craft-window button.cw-btn { padding: 5px 10px; border: 1px solid #8a6d32; border-radius: 3px; background: #3a2c14; color: #f1d58e; font: inherit; cursor: pointer; }
`;

type Tab = 'smith' | 'salvage';

export class CraftWindow {
  private readonly root: HTMLElement;
  private readonly skills: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'smith';
  private stats: PlayerStats | null = null;
  private bag: InventoryItemView[] = [];
  onAction: (d: { action: 'smith' | 'salvage'; recipe?: string; slot?: number; itemId?: string }) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'craft-window';
    this.root.hidden = true;
    const close = document.createElement('button');
    close.className = 'cw-close';
    close.textContent = '×';
    close.addEventListener('click', () => this.onClose());
    const h = document.createElement('h2');
    h.textContent = 'Anvil';
    this.skills = document.createElement('div');
    this.skills.className = 'cw-skills';
    const tabs = document.createElement('div');
    tabs.className = 'cw-tabs';
    for (const [t, label] of [['smith', 'Smithing'], ['salvage', 'Salvaging']] as const) {
      const b = document.createElement('button');
      b.className = 'cw-tab';
      b.textContent = label;
      b.addEventListener('click', () => {
        this.tab = t;
        this.render();
      });
      this.tabs.set(t, b);
      tabs.append(b);
    }
    this.body = document.createElement('div');
    this.root.append(close, h, this.skills, tabs, this.body);
    document.body.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  setStats(s: PlayerStats): void {
    this.stats = s;
    if (this.open) this.render();
  }

  setBag(items: readonly InventoryItemView[]): void {
    this.bag = [...items];
    if (this.open) this.render();
  }

  private level(skill: 'mining' | 'smithing' | 'salvaging'): number {
    return skillLevel(this.stats?.skills?.[skill] ?? 0);
  }

  private render(): void {
    for (const [k, b] of this.tabs) b.setAttribute('aria-selected', String(k === this.tab));
    const line = (s: 'mining' | 'smithing' | 'salvaging') => {
      const xp = this.stats?.skills?.[s] ?? 0;
      const l = skillLevel(xp);
      return `${s[0]!.toUpperCase()}${s.slice(1)} ${l}${l < 100 ? ` (${xp.toLocaleString('en-US')} / ${skillXpFor(l + 1).toLocaleString('en-US')})` : ''}`;
    };
    this.skills.textContent = (['mining', 'smithing', 'salvaging'] as const).map(line).join(' · ');
    this.body.replaceChildren();
    const list = document.createElement('div');
    list.className = 'cw-list';
    const have = (id: string) => this.bag.filter((i) => i.itemId === id).reduce((n, i) => n + (i.quantity ?? 1), 0);
    const name = (id: string) => BUILTIN_ITEMS.get(id)?.name ?? id;
    if (this.tab === 'smith') {
      const level = this.level('smithing');
      for (const r of RECIPES) {
        const row = document.createElement('div');
        const ok = level >= r.level && r.inputs.every((i) => have(i.itemId) >= i.count);
        row.className = `cw-row${level < r.level ? ' cw-locked' : ''}`;
        const label = document.createElement('div');
        label.innerHTML = '';
        label.append(`${r.name}${r.output.count > 1 ? ` ×${r.output.count}` : ''}`);
        const small = document.createElement('small');
        small.textContent = `Smithing ${r.level} · ${r.inputs.map((i) => `${i.count} × ${name(i.itemId)} (${have(i.itemId)})`).join(', ')} · ${r.gold} gold`;
        label.append(small);
        const b = this.button('Forge', () => this.onAction({ action: 'smith', recipe: r.id }));
        b.disabled = !ok;
        row.append(label, b);
        list.append(row);
      }
    } else {
      for (const i of this.bag.filter((x) => !x.equipped && !x.keyItem && !x.mods?.bound && moddable({ type: x.type }))) {
        const y = SALVAGE[i.mods?.rarity ?? 'worn'];
        const row = document.createElement('div');
        row.className = 'cw-row';
        const named = modsTitle(i.name, i.mods);
        const label = document.createElement('div');
        const title = document.createElement('span');
        title.textContent = named.title;
        if (named.color) title.style.color = named.color;
        const small = document.createElement('small');
        small.textContent = `Breaks into ${y.min === y.max ? y.min : `${y.min}–${y.max}`} × ${name(y.item)}`;
        label.append(title, small);
        row.append(label, this.button('Salvage', () => this.onAction({ action: 'salvage', slot: i.slot, itemId: i.itemId })));
        list.append(row);
      }
      if (!list.childElementCount) list.textContent = 'No gear in your bag to break down (worn gear stays).';
    }
    this.body.append(list);
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cw-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
