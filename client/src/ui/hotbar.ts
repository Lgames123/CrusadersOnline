import { BUILTIN_SPELLS, SPELL_NAMES, SPELLS, type InventoryItemView, type PlayerStats, type SpellId } from '@crusaders/shared';
import { formatKeyCode, HOTBAR_COLUMNS, HOTBAR_ROWS, SHIFT_PREFIX } from '../input/keybindings.ts';
import { ItemThumbnails } from './item_thumbnails.ts';
import { spellIconUrl } from './spell_icons.ts';

/**
 * What a hotbar slot holds. Items are kept by catalog id (bag slots move) with a snapshot of
 * their look and name, so a slot still shows what it was for once the last one is gone.
 */
export type HotbarEntry =
  | { kind: 'item'; itemId: string; name: string; type: InventoryItemView['type']; model?: number; texture?: number; width: number; height: number }
  | { kind: 'spell'; spell: SpellId };

/** Item types a slot takes: potions are drunk, gear is worn (quick weapon / shield / armour swaps). */
export const HOTBAR_ITEM_TYPES: ReadonlySet<InventoryItemView['type']> = new Set(['potion', 'weapon', 'shield', 'armor']);

const SLOTS = HOTBAR_COLUMNS * HOTBAR_ROWS;
const STORAGE = 'crusaders.hotbar.';
const DRAG_THRESHOLD = 5;

interface Layout {
  slots: (HotbarEntry | null)[];
  /** Rows shown: 0 (collapsed to its button), 1 or 2. */
  rows: number;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function hotbarItemEntry(item: InventoryItemView): HotbarEntry {
  return {
    kind: 'item', itemId: item.itemId, name: item.name, type: item.type,
    ...(item.model !== undefined ? { model: item.model } : {}), ...(item.texture !== undefined ? { texture: item.texture } : {}),
    width: Math.max(1, item.width ?? 1), height: Math.max(1, item.height ?? 1),
  };
}

function sanitizeEntry(raw: unknown): HotbarEntry | null {
  const r = raw as Partial<Record<string, unknown>> | null;
  if (!r || typeof r !== 'object') return null;
  if (r['kind'] === 'spell' && SPELLS.includes(r['spell'] as SpellId)) return { kind: 'spell', spell: r['spell'] as SpellId };
  if (r['kind'] === 'item' && typeof r['itemId'] === 'string' && HOTBAR_ITEM_TYPES.has(r['type'] as InventoryItemView['type'])) {
    const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : undefined);
    const model = num('model'), texture = num('texture');
    return {
      kind: 'item', itemId: r['itemId'], name: typeof r['name'] === 'string' ? r['name'] : r['itemId'], type: r['type'] as InventoryItemView['type'],
      ...(model !== undefined ? { model } : {}), ...(texture !== undefined ? { texture } : {}),
      width: Math.max(1, num('width') ?? 1), height: Math.max(1, num('height') ?? 1),
    };
  }
  return null;
}

/**
 * MMO-style action bar (not in the original): two rows of nine, bottom centre. Row 1 is on 1-9,
 * row 2 on Shift+1-9 (rebindable). Slots hold potions, gear and spells; `+` / `−` show and hide
 * rows (keys work for hidden rows too). The layout is kept per character in this browser.
 * Clicks, drags and tooltips need the cursor (inventory open, or Alt held).
 */
export class Hotbar {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly ghost: HTMLImageElement;
  private storageKey = `${STORAGE}guest`;
  private layout: Layout = { slots: Array<HotbarEntry | null>(SLOTS).fill(null), rows: 1 };
  private items: readonly InventoryItemView[] = [];
  private stats: PlayerStats | null = null;
  private keys: readonly string[] = [];
  private press: { index: number | null; entry: HotbarEntry; x: number; y: number; pointerId: number; icon: string | null } | null = null;
  private dragging = false;
  private suppressClick = false;
  private html = '';
  /** Potion cooldowns by item id: when they end (performance.now() ms) and their full length (ms). */
  private cooldowns = new Map<string, { end: number; total: number }>();
  private cooldownFrame = 0;

  /** A slot was used (key or click). */
  onActivate: (entry: HotbarEntry) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `<div class="hb-bar"></div><div class="hb-tooltip" role="tooltip" hidden></div><img class="hb-ghost" alt="" hidden />`;
    this.bar = root.querySelector('.hb-bar')!;
    this.tooltip = root.querySelector('.hb-tooltip')!;
    this.ghost = root.querySelector('.hb-ghost')!;
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('contextmenu', (e) => {
      const slot = this.slotOf(e.target);
      e.preventDefault();
      if (slot !== null && this.layout.slots[slot]) this.set(slot, null);
    });
    root.addEventListener('pointerdown', (e) => {
      const index = this.slotOf(e.target);
      const entry = index !== null ? this.layout.slots[index] : null;
      if (e.button !== 0 || index === null || !entry) return;
      e.preventDefault();
      this.press = { index, entry, x: e.clientX, y: e.clientY, pointerId: e.pointerId, icon: this.iconOf(entry) };
    });
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', () => this.endDrag());
    window.addEventListener('blur', () => this.endDrag());
    root.addEventListener('pointerover', (e) => this.hover(e));
    root.addEventListener('pointerout', (e) => {
      if (this.slotOf(e.relatedTarget) === null) this.tooltip.hidden = true;
    });
    ItemThumbnails.get().onChange((key, url) => {
      for (const img of root.querySelectorAll<HTMLImageElement>(`img[data-thumb-key="${key}"]`)) {
        img.src = url;
        img.hidden = false;
      }
    });
    root.hidden = true;
    this.render();
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
    if (!v) {
      this.endDrag();
      this.tooltip.hidden = true;
    }
  }

  /** Loads the layout kept for this character (account character id, or the guest's). */
  setCharacter(id: string | number | null): void {
    this.storageKey = `${STORAGE}${id ?? 'guest'}`;
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
    } catch {
      // Storage unavailable: an empty bar for this session.
    }
    const r = (raw && typeof raw === 'object' ? raw : {}) as { slots?: unknown; rows?: unknown };
    const slots = Array.isArray(r.slots) ? r.slots : [];
    this.layout = {
      slots: Array.from({ length: SLOTS }, (_, i) => sanitizeEntry(slots[i])),
      rows: typeof r.rows === 'number' && r.rows >= 0 && r.rows <= HOTBAR_ROWS ? Math.round(r.rows) : 1,
    };
    this.render();
  }

  setKeys(keys: readonly string[]): void {
    this.keys = keys;
    this.render();
  }

  setInventory(items: readonly InventoryItemView[]): void {
    this.items = items;
    // The server says how long each cooling potion has left; a near repeat keeps the end already
    // shown (so the overlay does not jump on every inventory update).
    const now = performance.now();
    const next = new Map<string, { end: number; total: number }>();
    for (const i of items) {
      if (!i.cooldownLeft || next.has(i.itemId)) continue;
      const end = now + i.cooldownLeft * 1000;
      const had = this.cooldowns.get(i.itemId);
      next.set(i.itemId, had && Math.abs(had.end - end) < 300 ? had : { end, total: Math.max(i.cooldown ?? 0, i.cooldownLeft) * 1000 });
    }
    // Used up during its cooldown: still shown on the (now empty) slot until it runs out.
    for (const [id, cd] of this.cooldowns) if (!next.has(id) && cd.end > now && !items.some((i) => i.itemId === id)) next.set(id, cd);
    this.cooldowns = next;
    this.render();
    this.tickCooldowns();
  }

  /** A potion of this id is cooling down (it cannot be drunk yet). */
  cooling(itemId: string): boolean {
    return (this.cooldowns.get(itemId)?.end ?? 0) > performance.now();
  }

  setStats(stats: PlayerStats): void {
    this.stats = stats;
    this.render();
  }

  entry(slot: number): HotbarEntry | null {
    return this.layout.slots[slot] ?? null;
  }

  /** Uses a slot (its key): flashes it and reports the entry. */
  activate(slot: number): void {
    const entry = this.entry(slot);
    if (!entry) return;
    const el = this.bar.querySelector<HTMLElement>(`[data-hb-slot="${slot}"]`);
    if (el) {
      el.classList.remove('hb-pressed');
      void el.offsetWidth; // restart the flash
      el.classList.add('hb-pressed');
    }
    this.onActivate(entry);
  }

  set(slot: number, entry: HotbarEntry | null): void {
    this.layout.slots[slot] = entry;
    this.save();
    this.render();
  }

  /** The visible slot under a screen point (drops from the inventory), or null. */
  slotAt(x: number, y: number): number | null {
    if (this.root.hidden) return null;
    return this.slotOf(document.elementFromPoint(x, y));
  }

  /** Marks the slot a drag from elsewhere would land in (null clears). */
  highlight(slot: number | null): void {
    for (const el of this.bar.querySelectorAll('.hb-drop')) el.classList.remove('hb-drop');
    if (slot !== null) this.bar.querySelector(`[data-hb-slot="${slot}"]`)?.classList.add('hb-drop');
  }

  /** Starts dragging an entry from elsewhere (a spell from the inventory's Spells page). */
  dragFrom(entry: HotbarEntry, e: PointerEvent): void {
    if (this.root.hidden) return;
    this.press = { index: null, entry, x: e.clientX, y: e.clientY, pointerId: e.pointerId, icon: this.iconOf(entry) };
  }

  // --- Rendering

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.layout));
    } catch {
      // Not kept; still used this session.
    }
  }

  private setRows(rows: number): void {
    this.layout.rows = Math.max(0, Math.min(HOTBAR_ROWS, rows));
    this.tooltip.hidden = true;
    this.save();
    this.render();
  }

  private keyLabel(slot: number): string {
    const code = this.keys[slot] ?? '';
    if (!code) return '';
    return code.startsWith(SHIFT_PREFIX) ? `⇧${formatKeyCode(code.slice(SHIFT_PREFIX.length))}` : formatKeyCode(code);
  }

  private owned(itemId: string): InventoryItemView[] {
    return this.items.filter((i) => i.itemId === itemId);
  }

  private iconOf(entry: HotbarEntry): string | null {
    if (entry.kind === 'spell') return spellIconUrl(entry.spell, () => this.render());
    return ItemThumbnails.get().getIcon(entry.model, entry.width, entry.height, entry.texture);
  }

  private spellCost(spell: SpellId): number | null {
    const level = this.stats?.spells.find((k) => k.spell === spell)?.level;
    return level ? BUILTIN_SPELLS[spell]?.[level - 1]?.mana ?? 0 : null;
  }

  private slotHtml(slot: number): string {
    const entry = this.layout.slots[slot];
    const key = `<span class="hb-key">${escape(this.keyLabel(slot))}</span>`;
    if (!entry) return `<div class="hb-slot hb-empty" data-hb-slot="${slot}">${key}</div>`;
    const classes = ['hb-slot', `hb-${entry.kind}`];
    let body = '';
    if (entry.kind === 'spell') {
      const url = this.iconOf(entry);
      const cost = this.spellCost(entry.spell);
      if (cost === null) classes.push('hb-missing');
      else if ((this.stats?.mana ?? 0) < cost) classes.push('hb-nomana');
      if (this.stats?.spell === entry.spell) classes.push('hb-active');
      body = url ? `<img class="hb-icon hb-spell-icon" src="${url}" alt="" draggable="false" />` : `<span class="hb-glyph">✦</span>`;
    } else {
      const owned = this.owned(entry.itemId);
      if (!owned.length) classes.push('hb-missing');
      if (owned.some((i) => i.equipped)) classes.push('hb-active');
      const url = this.iconOf(entry);
      const thumbKey = entry.model !== undefined ? ItemThumbnails.iconKey(entry.model, entry.width, entry.height, entry.texture) : '';
      body = entry.model !== undefined
        ? `<img class="hb-icon" data-thumb-key="${thumbKey}" src="${url ?? ''}" alt="" draggable="false" ${url ? '' : 'hidden'} />`
        : `<span class="hb-glyph">${entry.type === 'potion' ? '⚗' : '⚔'}</span>`;
      if (entry.type === 'potion') body += `<span class="hb-count">${owned.reduce((n, i) => n + (i.quantity ?? 1), 0)}</span>`;
      // The cooldown: a translucent white cover that drains away with it (sized by tickCooldowns).
      if (this.cooling(entry.itemId)) {
        classes.push('hb-cooling');
        body += `<span class="hb-cd"></span><span class="hb-cd-time"></span>`;
      }
    }
    return `<div class="${classes.join(' ')}" data-hb-slot="${slot}">${body}${key}</div>`;
  }

  private render(): void {
    if (this.dragging) return;
    const rows = this.layout.rows;
    // Row 2 sits above row 1.
    const shown = Array.from({ length: rows }, (_, r) => rows - 1 - r);
    const html = `${shown.map((r) => `<div class="hb-row" data-hb-row="${r}">${Array.from({ length: HOTBAR_COLUMNS }, (_, c) => this.slotHtml(r * HOTBAR_COLUMNS + c)).join('')}</div>`).join('')}
      <div class="hb-controls">
        ${rows < HOTBAR_ROWS ? `<button type="button" data-hb-rows="${rows + 1}" title="${rows ? 'Show another row' : 'Show the hotbar'}">+</button>` : ''}
        ${rows > 0 ? `<button type="button" data-hb-rows="${rows - 1}" title="Hide a row">−</button>` : ''}
        ${rows > 1 ? `<button type="button" data-hb-rows="0" title="Hide the hotbar">▾</button>` : ''}
      </div>`;
    // Stats arrive often: the DOM is only rebuilt when what it shows changed (a rebuild mid-click loses the click).
    if (html !== this.html) {
      this.html = html;
      this.bar.innerHTML = html;
    }
    this.root.classList.toggle('hb-collapsed', rows === 0);
  }

  /** Sizes the cooldown covers every frame while any cooldown runs; one that ends redraws its slot. */
  private tickCooldowns(): void {
    if (this.cooldownFrame) return;
    const step = () => {
      this.cooldownFrame = 0;
      const now = performance.now();
      let ended = false;
      for (const [id, cd] of this.cooldowns) {
        if (cd.end > now) continue;
        this.cooldowns.delete(id);
        ended = true;
      }
      if (ended) this.render();
      for (const el of this.bar.querySelectorAll<HTMLElement>('.hb-cooling')) {
        const entry = this.layout.slots[Number(el.dataset['hbSlot'])];
        const cd = entry?.kind === 'item' ? this.cooldowns.get(entry.itemId) : undefined;
        if (!cd) continue;
        const left = cd.end - now;
        el.querySelector<HTMLElement>('.hb-cd')!.style.height = `${Math.min(100, (left / cd.total) * 100).toFixed(2)}%`;
        el.querySelector<HTMLElement>('.hb-cd-time')!.textContent = `${Math.ceil(left / 1000)}`;
      }
      if (this.cooldowns.size) this.cooldownFrame = requestAnimationFrame(step);
    };
    this.cooldownFrame = requestAnimationFrame(step);
  }

  // --- Pointer

  private slotOf(target: EventTarget | null): number | null {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-hb-slot]');
    return el && this.root.contains(el) ? Number(el.dataset['hbSlot']) : null;
  }

  private click(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const rows = (e.target as HTMLElement).closest<HTMLElement>('[data-hb-rows]');
    if (rows) {
      this.setRows(Number(rows.dataset['hbRows']));
      return;
    }
    const slot = this.slotOf(e.target);
    if (slot !== null) this.activate(slot);
  }

  private hover(e: PointerEvent): void {
    if (this.press) return;
    const slot = this.slotOf(e.target);
    const entry = slot !== null ? this.layout.slots[slot] : null;
    const el = slot !== null ? this.bar.querySelector<HTMLElement>(`[data-hb-slot="${slot}"]`) : null;
    if (!entry || !el) {
      this.tooltip.hidden = true;
      return;
    }
    let name: string, detail = '';
    if (entry.kind === 'spell') {
      name = SPELL_NAMES[entry.spell];
      const level = this.stats?.spells.find((k) => k.spell === entry.spell)?.level;
      detail = level ? `Level ${level} · ${this.spellCost(entry.spell)} mana` : 'Not known';
    } else {
      name = entry.name;
      const owned = this.owned(entry.itemId);
      const cooldown = owned.find((i) => i.cooldown)?.cooldown;
      detail = !owned.length ? 'None carried'
        : entry.type === 'potion' ? `Drink${cooldown ? ` · ${cooldown} s cooldown` : ''}`
          : owned.some((i) => i.equipped) ? 'Equipped' : 'Equip';
    }
    this.tooltip.innerHTML = `<strong>${escape(name)}</strong><small>${escape(detail)}</small>`;
    this.tooltip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = this.tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    this.tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(r.top - t.height - 6)}px)`;
  }

  private pointerMove(e: PointerEvent): void {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    if (!this.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
    if (!this.dragging) {
      this.dragging = true;
      this.tooltip.hidden = true;
      this.root.classList.add('hb-is-dragging');
      if (press.index !== null) this.bar.querySelector(`[data-hb-slot="${press.index}"]`)?.classList.add('hb-dragging');
      if (press.icon) this.ghost.src = press.icon;
      this.ghost.hidden = !press.icon;
    }
    this.ghost.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`;
    this.highlight(this.slotAt(e.clientX, e.clientY));
  }

  private pointerUp(e: PointerEvent): void {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    const wasDragging = this.dragging;
    const to = wasDragging ? this.slotAt(e.clientX, e.clientY) : null;
    this.endDrag();
    if (!wasDragging) return; // a click: the click handler uses the slot
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
    const slots = this.layout.slots;
    if (press.index === null) {
      if (to !== null) this.set(to, press.entry);
    } else if (to === null) {
      // Dragged off the bar: cleared.
      this.set(press.index, null);
    } else if (to !== press.index) {
      [slots[to], slots[press.index]] = [slots[press.index] ?? null, slots[to] ?? null];
      this.save();
      this.render();
    }
  }

  private endDrag(): void {
    this.press = null;
    if (!this.dragging) return;
    this.dragging = false;
    this.ghost.hidden = true;
    this.root.classList.remove('hb-is-dragging');
    this.highlight(null);
    this.html = '';
    this.render();
  }
}
