import { DAMAGE_TYPES, affixLines, modsTitle, type InventoryItemView, type TradeUpdateMsg } from '@crusaders/shared';

/**
 * The direct trade window (MMO Stage 4, not original). The player's tradable bag items as
 * toggles (worn, key and bound items are left out), the gold to give, then Lock and Confirm; the
 * partner's offer beside it with each item's stats. Every change to either offer unlocks both
 * (the server rules). Styles live here.
 */
const STYLE = `
#trade-window { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 13; width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
  padding: 14px 16px; border: 2px solid #8a6d32; border-radius: 6px; background: rgba(14,12,9,.95); color: #f0e6cc; font: 13px/1.35 Georgia, serif; box-shadow: 0 12px 40px rgba(0,0,0,.8); }
#trade-window[hidden] { display: none; }
#trade-window h2 { margin: 0 0 10px; font-size: 18px; font-weight: normal; color: #f1d58e; }
#trade-window .tw-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { #trade-window .tw-cols { grid-template-columns: 1fr; } }
#trade-window h3 { margin: 0 0 6px; font-size: 14px; font-weight: normal; color: #d8c69a; }
#trade-window .tw-list { display: grid; gap: 4px; max-height: 260px; overflow: auto; }
#trade-window .tw-item { display: block; width: 100%; text-align: left; padding: 5px 7px; border: 1px solid #4a3c22; border-radius: 3px; background: rgba(40,32,20,.7); color: inherit; font: inherit; cursor: pointer; }
#trade-window .tw-item[aria-pressed="true"] { border-color: #8fd0ff; background: rgba(30,60,100,.7); }
#trade-window .tw-item small { display: block; color: #a9b2c0; }
#trade-window .tw-theirs .tw-item { cursor: default; }
#trade-window .tw-state { margin: 6px 0; color: #a9c7e8; }
#trade-window .tw-state.ok { color: #8fe08f; }
#trade-window .tw-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
#trade-window input { width: 110px; padding: 4px 6px; background: #1d1810; color: #f0e6cc; border: 1px solid #5d4a23; border-radius: 3px; font: inherit; }
#trade-window button.tw-btn { padding: 6px 12px; border: 1px solid #8a6d32; border-radius: 3px; background: #3a2c14; color: #f1d58e; font: inherit; cursor: pointer; }
#trade-window button.tw-btn:disabled { opacity: .5; cursor: default; }
`;

type Side = NonNullable<TradeUpdateMsg['d']['mine']>;

function describeItem(i: InventoryItemView): string {
  const parts: string[] = [];
  i.damage?.forEach((v, t) => v > 0 && parts.push(`${Math.round(v * 10) / 10} ${DAMAGE_TYPES[t]!.toLowerCase()}`));
  i.protection?.forEach((v, t) => v < 1 && parts.push(`${Math.round((1 - v) * 100)} % ${DAMAGE_TYPES[t]!.toLowerCase()}`));
  parts.push(...affixLines(i.mods));
  if (i.quantity && i.quantity > 1) parts.push(`×${i.quantity}`);
  return parts.join(', ');
}

export class TradeWindow {
  private readonly root: HTMLElement;
  private partner = '';
  private mine: Side | null = null;
  private theirs: Side | null = null;
  private bag: InventoryItemView[] = [];
  private selected = new Set<string>();
  onAction: (d: { action: 'offer' | 'lock' | 'confirm' | 'cancel'; uids?: string[]; gold?: number }) => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'trade-window';
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** The player's bag (only unworn, tradable items are offered). */
  setBag(items: readonly InventoryItemView[]): void {
    this.bag = items.filter((i) => !i.equipped && !i.keyItem && !i.mods?.bound && i.uid);
    if (this.open) this.render();
  }

  update(d: TradeUpdateMsg['d']): void {
    if (d.state !== 'open') {
      this.root.hidden = true;
      this.selected.clear();
      return;
    }
    this.partner = d.partner;
    this.mine = d.mine ?? null;
    this.theirs = d.theirs ?? null;
    this.selected = new Set((d.mine?.items ?? []).map((i) => i.uid!).filter(Boolean));
    this.root.hidden = false;
    this.render();
  }

  private render(): void {
    const mine = this.mine, theirs = this.theirs;
    if (!mine || !theirs) return;
    this.root.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = `Trade with ${this.partner}`;
    const cols = document.createElement('div');
    cols.className = 'tw-cols';
    // Mine: the bag as toggles.
    const left = document.createElement('div');
    left.innerHTML = '<h3>Your offer (click to add or remove)</h3>';
    const list = document.createElement('div');
    list.className = 'tw-list';
    for (const i of this.bag) {
      const b = this.itemButton(i);
      b.setAttribute('aria-pressed', String(this.selected.has(i.uid!)));
      b.addEventListener('click', () => {
        if (this.selected.has(i.uid!)) this.selected.delete(i.uid!);
        else this.selected.add(i.uid!);
        this.onAction({ action: 'offer', uids: [...this.selected], gold: this.goldValue() });
      });
      list.append(b);
    }
    if (!this.bag.length) list.textContent = 'Nothing you could trade.';
    left.append(list, this.state(mine, 'You'));
    // Theirs.
    const right = document.createElement('div');
    right.className = 'tw-theirs';
    right.innerHTML = `<h3>${this.partner} offers</h3>`;
    const theirList = document.createElement('div');
    theirList.className = 'tw-list';
    for (const i of theirs.items) theirList.append(this.itemButton(i));
    const gold = document.createElement('div');
    gold.textContent = `${theirs.gold.toLocaleString('en-US')} gold`;
    if (!theirs.items.length && !theirs.gold) theirList.textContent = 'Nothing yet.';
    right.append(theirList, gold, this.state(theirs, this.partner));
    cols.append(left, right);
    // Gold and the buttons.
    const row = document.createElement('div');
    row.className = 'tw-row';
    const label = document.createElement('label');
    label.textContent = 'Gold ';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = String(mine.gold);
    input.addEventListener('change', () => this.onAction({ action: 'offer', uids: [...this.selected], gold: this.goldValue() }));
    label.append(input);
    const lock = this.button(mine.locked ? 'Locked' : 'Lock offer', () => this.onAction({ action: 'lock' }), mine.locked);
    const confirm = this.button(mine.confirmed ? 'Confirmed' : 'Confirm', () => this.onAction({ action: 'confirm' }), !(mine.locked && theirs.locked) || mine.confirmed);
    const cancel = this.button('Cancel', () => this.onAction({ action: 'cancel' }), false);
    row.append(label, lock, confirm, cancel);
    this.root.append(h, cols, row);
  }

  private goldValue(): number {
    const v = Number(this.root.querySelector<HTMLInputElement>('input[type=number]')?.value ?? 0);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }

  private itemButton(i: InventoryItemView): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tw-item';
    const named = modsTitle(i.name, i.mods);
    const name = document.createElement('span');
    name.textContent = named.title;
    if (named.color) name.style.color = named.color;
    const small = document.createElement('small');
    small.textContent = describeItem(i);
    b.append(name, small);
    return b;
  }

  private state(side: Side, who: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `tw-state${side.confirmed ? ' ok' : ''}`;
    el.textContent = side.confirmed ? `${who}: confirmed` : side.locked ? `${who}: locked` : `${who}: choosing`;
    return el;
  }

  private button(text: string, onClick: () => void, disabled: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tw-btn';
    b.textContent = text;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }
}
