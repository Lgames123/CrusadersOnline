import { affixLines, modsTitle, type AuctionMsg, type InventoryItemView } from '@crusaders/shared';

/**
 * The auction house (MMO Stage 4, not original), at a merchant: Browse (search, buy at the
 * listed price, cancel one's own), Sell (a bag item, its price and 12 / 24 / 48 hours: the
 * deposit is 5 % × 1 / 1.5 / 2, not returned; a sale pays the price less 10 %), Mailbox (what was
 * bought, sold or returned, collected all at once). Styles live here.
 */
const STYLE = `
#auction-window { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 13; width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
  padding: 14px 16px; border: 2px solid #8a6d32; border-radius: 6px; background: rgba(14,12,9,.96); color: #f0e6cc; font: 13px/1.35 Georgia, serif; box-shadow: 0 12px 40px rgba(0,0,0,.8); }
#auction-window[hidden] { display: none; }
#auction-window h2 { margin: 0 0 8px; font-size: 18px; font-weight: normal; color: #f1d58e; }
#auction-window .ah-close { position: absolute; right: 10px; top: 6px; background: none; border: 0; color: #d8c69a; font-size: 22px; cursor: pointer; }
#auction-window .ah-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
#auction-window .ah-tab { padding: 5px 12px; border: 1px solid #5d4a23; border-radius: 3px; background: rgba(30,24,14,.8); color: #d8c69a; font: inherit; cursor: pointer; }
#auction-window .ah-tab[aria-selected="true"] { border-color: #8fd0ff; color: #fff; background: rgba(30,60,100,.75); }
#auction-window .ah-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 6px 8px; border-bottom: 1px solid #2e261a; }
#auction-window .ah-row small { display: block; color: #a9b2c0; }
#auction-window .ah-list { max-height: 50vh; overflow: auto; }
#auction-window .ah-price { color: #f1d58e; white-space: nowrap; }
#auction-window button.ah-btn { padding: 5px 10px; border: 1px solid #8a6d32; border-radius: 3px; background: #3a2c14; color: #f1d58e; font: inherit; cursor: pointer; }
#auction-window input, #auction-window select { padding: 4px 6px; background: #1d1810; color: #f0e6cc; border: 1px solid #5d4a23; border-radius: 3px; font: inherit; }
#auction-window .ah-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
#auction-window .ah-empty { color: #9a8f78; padding: 8px; }
#auction-window .ah-picked { border-color: #8fd0ff; }
`;

type Tab = 'browse' | 'sell' | 'mail';
type AuctionAction = { action: 'search' | 'list' | 'buy' | 'cancel' | 'mail' | 'claim'; q?: string; id?: string; slot?: number; itemId?: string; price?: number; hours?: number };

export class AuctionWindow {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'browse';
  private data: AuctionMsg['d'] = { listings: [], mail: [] };
  private bag: InventoryItemView[] = [];
  private query = '';
  private picked: InventoryItemView | null = null;
  onAction: (d: AuctionAction) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'auction-window';
    this.root.hidden = true;
    const close = document.createElement('button');
    close.className = 'ah-close';
    close.textContent = '×';
    close.addEventListener('click', () => this.onClose());
    const h = document.createElement('h2');
    h.textContent = 'Auction House';
    const tabs = document.createElement('div');
    tabs.className = 'ah-tabs';
    for (const [t, label] of [['browse', 'Browse'], ['sell', 'Sell'], ['mail', 'Mailbox']] as const) {
      const b = document.createElement('button');
      b.className = 'ah-tab';
      b.textContent = label;
      b.addEventListener('click', () => this.select(t));
      this.tabs.set(t, b);
      tabs.append(b);
    }
    this.body = document.createElement('div');
    this.root.append(close, h, tabs, this.body);
    document.body.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.select(this.tab);
    this.onAction({ action: 'search', q: this.query });
  }

  hide(): void {
    this.root.hidden = true;
  }

  setBag(items: readonly InventoryItemView[]): void {
    this.bag = items.filter((i) => !i.equipped && !i.keyItem && !i.mods?.bound);
    if (this.picked && !this.bag.some((i) => i.slot === this.picked!.slot && i.itemId === this.picked!.itemId)) this.picked = null;
    if (this.open && this.tab === 'sell') this.render();
  }

  update(d: AuctionMsg['d']): void {
    this.data = d;
    const mail = this.tabs.get('mail')!;
    mail.textContent = d.mail.length ? `Mailbox (${d.mail.length})` : 'Mailbox';
    if (this.open) this.render();
  }

  private select(t: Tab): void {
    this.tab = t;
    for (const [k, b] of this.tabs) b.setAttribute('aria-selected', String(k === t));
    this.render();
  }

  private render(): void {
    this.body.replaceChildren();
    if (this.tab === 'browse') this.renderBrowse();
    else if (this.tab === 'sell') this.renderSell();
    else this.renderMail();
  }

  private renderBrowse(): void {
    const form = document.createElement('form');
    form.className = 'ah-form';
    const q = document.createElement('input');
    q.placeholder = 'Item name…';
    q.value = this.query;
    const go = this.button('Search', () => undefined);
    go.type = 'submit';
    form.append(q, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.query = q.value;
      this.onAction({ action: 'search', q: this.query });
    });
    const list = document.createElement('div');
    list.className = 'ah-list';
    for (const l of this.data.listings) {
      const left = Math.max(0, new Date(l.expiresAt).getTime() - Date.now());
      const row = this.itemRow(l.name, l.mods, `${l.quantity > 1 ? `×${l.quantity} · ` : ''}${l.seller} · ${Math.ceil(left / 3_600_000)} h left`);
      const price = document.createElement('span');
      price.className = 'ah-price';
      price.textContent = `${l.price.toLocaleString('en-US')} gold`;
      row.append(price, l.mine ? this.button('Cancel', () => this.onAction({ action: 'cancel', id: l.id, q: this.query })) : this.button('Buy', () => this.onAction({ action: 'buy', id: l.id })));
      list.append(row);
    }
    if (!this.data.listings.length) list.append(this.empty('Nothing for sale.'));
    this.body.append(form, list);
  }

  private renderSell(): void {
    const list = document.createElement('div');
    list.className = 'ah-list';
    for (const i of this.bag) {
      const row = this.itemRow(i.name, i.mods, `${i.quantity && i.quantity > 1 ? `×${i.quantity} · ` : ''}${i.type}`);
      if (this.picked?.slot === i.slot) row.classList.add('ah-picked');
      row.append(document.createElement('span'), this.button(this.picked?.slot === i.slot ? 'Chosen' : 'Choose', () => {
        this.picked = i;
        this.render();
      }));
      list.append(row);
    }
    if (!this.bag.length) list.append(this.empty('Nothing you could sell (worn, key and bound items stay).'));
    const form = document.createElement('div');
    form.className = 'ah-form';
    const price = document.createElement('input');
    price.type = 'number';
    price.min = '1';
    price.placeholder = 'Price';
    const hours = document.createElement('select');
    for (const h of [12, 24, 48]) hours.append(new Option(`${h} hours`, String(h), h === 24, h === 24));
    const note = document.createElement('span');
    const refresh = () => {
      const p = Math.floor(Number(price.value));
      const mult = ({ 12: 1, 24: 1.5, 48: 2 } as Record<string, number>)[hours.value] ?? 1;
      note.textContent = p > 0 ? `Deposit ${Math.max(1, Math.floor(p * 0.05 * mult))} gold · you get ${Math.floor(p * 0.9)} if sold` : '';
    };
    price.addEventListener('input', refresh);
    hours.addEventListener('change', refresh);
    const list_ = this.button('List', () => {
      const p = Math.floor(Number(price.value));
      if (!this.picked || !(p > 0)) return;
      this.onAction({ action: 'list', slot: this.picked.slot, itemId: this.picked.itemId, price: p, hours: Number(hours.value) });
      this.picked = null;
    });
    form.append(this.picked ? `${this.picked.name}:` : 'Choose an item,', price, hours, list_, note);
    this.body.append(list, form);
  }

  private renderMail(): void {
    const list = document.createElement('div');
    list.className = 'ah-list';
    for (const m of this.data.mail) {
      const what = m.item ? `${m.item.name}${m.item.quantity > 1 ? ` ×${m.item.quantity}` : ''}` : '';
      const row = this.itemRow(m.subject, m.item?.mods, [what, m.gold ? `${m.gold.toLocaleString('en-US')} gold` : ''].filter(Boolean).join(' · ') || m.sender);
      row.append(document.createElement('span'), document.createElement('span'));
      list.append(row);
    }
    if (!this.data.mail.length) list.append(this.empty('Your mailbox is empty.'));
    const form = document.createElement('div');
    form.className = 'ah-form';
    if (this.data.mail.length) form.append(this.button('Collect all', () => this.onAction({ action: 'claim' })));
    this.body.append(list, form);
  }

  private itemRow(name: string, mods: AuctionMsg['d']['listings'][number]['mods'], sub: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ah-row';
    const label = document.createElement('div');
    const named = modsTitle(name, mods);
    const title = document.createElement('span');
    title.textContent = named.title;
    if (named.color) title.style.color = named.color;
    const small = document.createElement('small');
    small.textContent = [sub, ...affixLines(mods)].filter(Boolean).join(' · ');
    label.append(title, small);
    row.append(label);
    return row;
  }

  private empty(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ah-empty';
    el.textContent = text;
    return el;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ah-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
