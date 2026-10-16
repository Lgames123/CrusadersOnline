import { canPlaceGrid, DAMAGE_TYPES, firstFreeGridPosition, INVENTORY_GRID, layoutItemViews, type GridPlacement, type Inventory, type InventoryItemView } from '@crusaders/shared';
import { HeldItemPreview } from './held_item_preview.ts';
import { ItemThumbnails } from './item_thumbnails.ts';
import { itemPreviewModelFile } from '../assets/item_models.ts';

/** The inventory window (character equipment over the bag) and the ground window beside it. */
export type InventoryPanelKind = 'inventory' | 'ground';

export interface GroundItemView {
  id: number;
  name: string;
  quantity: number;
  distance: number;
}

type EquipKind = 'weapon' | 'shield' | 'armor';

const ITEM_MARK: Record<InventoryItemView['type'], string> = {
  weapon: '⚔', shield: '◈', armor: '♜', potion: '⚗', spellbook: '✦', key: '⚿',
};

const TYPE_LABEL: Record<InventoryItemView['type'], string> = {
  weapon: 'Weapon', shield: 'Shield', armor: 'Armour', potion: 'Potion', spellbook: 'Spell book', key: 'Quest item',
};

/**
 * Paper-doll slots on the 8-cell-wide equipment board (MU Online's layout around the body):
 * column / row / span in board cells. Only weapon, shield and armour exist in the ruleset.
 */
const EQUIP_SLOTS: { kind: EquipKind | 'head' | 'ring1' | 'ring2'; label: string; area: string }[] = [
  { kind: 'ring1', label: 'Ring', area: '1 / 2 / span 1 / span 1' },
  { kind: 'head', label: 'Helm', area: '1 / 4 / span 2 / span 2' },
  { kind: 'ring2', label: 'Ring', area: '1 / 7 / span 1 / span 1' },
  { kind: 'weapon', label: 'Weapon', area: '2 / 1 / span 3 / span 2' },
  { kind: 'armor', label: 'Armour', area: '3 / 4 / span 3 / span 2' },
  { kind: 'shield', label: 'Shield', area: '2 / 7 / span 3 / span 2' },
];

/** How far (CSS px) the pointer travels before a press on an item becomes a drag. */
const DRAG_THRESHOLD = 5;
/** A sent request blocks further item actions until the server answers (or this long). */
const REQUEST_TIMEOUT_MS = 1500;

function isEquipKind(type: InventoryItemView['type']): type is EquipKind {
  return type === 'weapon' || type === 'shield' || type === 'armor';
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function shapeOf(item: InventoryItemView): { width: number; height: number } {
  return { width: Math.max(1, item.width ?? 1), height: Math.max(1, item.height ?? 1) };
}

/** What releasing the dragged item here would do. */
type DropAction =
  | { kind: 'none' }
  | { kind: 'drop' }
  | { kind: 'move'; x: number; y: number; valid: boolean }
  | { kind: 'merge'; toSlot: number }
  | { kind: 'equip'; slot: number; valid: boolean }
  | { kind: 'unequip'; x: number; y: number; valid: boolean };

interface Drag {
  item: InventoryItemView;
  source: HTMLElement;
  /** Grabbed cell within the item's footprint. */
  grab: { x: number; y: number };
  target: HTMLElement;
}

interface Press {
  item: InventoryItemView;
  source: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
}

/**
 * MU Online-style inventory: one framed window anchored bottom-right, the character's equipment
 * board on top of the 8×6 bag (item shapes from items.ctx). The ground window (button or Ctrl+G)
 * opens beside it, pushing it left. Every change is a request; the server's INVENTORY_UPDATE is
 * the only state shown, and one request is in flight at a time (no double sends).
 */
export class InventoryPanels {
  private readonly root: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly equipment: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly groundList: HTMLElement;
  private readonly goldValue: HTMLElement;
  private readonly countValue: HTMLElement;
  private readonly tooltip: HTMLElement;
  private inventory: Inventory | null = null;
  private ground: GroundItemView[] = [];
  private readonly shown: Record<InventoryPanelKind, boolean> = { inventory: false, ground: false };
  private groundSignature = '';
  private press: Press | null = null;
  private drag: Drag | null = null;
  /** An update that arrived mid-drag: applied when the drag ends. */
  private renderPending = false;
  private suppressClick = false;
  private awaitingUntil = 0;
  private readonly preview = new HeldItemPreview();

  onEquip: (slot: number, itemId: string, equip: boolean, to?: { x: number; y: number }) => void = () => {};
  onUse: (slot: number, itemId: string) => void = () => {};
  onMove: (slot: number, itemId: string, x: number, y: number) => void = () => {};
  onMerge: (fromSlot: number, toSlot: number) => void = () => {};
  onSplit: (slot: number, quantity: number) => void = () => {};
  onPickup: (object: number) => void = () => {};
  onDrop: (slot: number, itemId: string) => void = () => {};
  /** The player asked to open or close a window (button, ×). */
  onToggle: (kind: InventoryPanelKind, open: boolean) => void = () => {};
  onNotice?: (message: string) => void;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `<div class="inv-dock">
      <section class="inv-window inv-main" aria-label="Inventory">
        <header class="inv-title"><h2>Inventory</h2><button type="button" class="inv-x" data-close="inventory" aria-label="Close inventory">×</button></header>
        <div class="inv-equipment" aria-label="Equipment"></div>
        <div class="inv-grid" style="--inv-columns:${INVENTORY_GRID.columns};--inv-rows:${INVENTORY_GRID.rows}" aria-label="Bag"></div>
        <footer class="inv-footer">
          <span class="inv-gold" title="Gold"><i aria-hidden="true"></i><b>0</b></span>
          <span class="inv-count"></span>
          <button type="button" class="inv-ground-toggle" data-toggle="ground" aria-pressed="false" title="Items on the ground nearby (Ctrl+G)">Ground <kbd>Ctrl+G</kbd></button>
        </footer>
      </section>
      <section class="inv-window inv-ground" aria-label="Items on the ground">
        <div class="inv-ground-inner">
          <header class="inv-title"><h2>Ground</h2><button type="button" class="inv-x" data-close="ground" aria-label="Close ground items">×</button></header>
          <div class="ground-list"></div>
          <p class="inv-help">Click to pick up. Drag an item here to drop it.</p>
        </div>
      </section>
    </div>
    <div class="inv-tooltip" role="tooltip" hidden></div>`;
    this.dock = root.querySelector('.inv-dock')!;
    this.equipment = root.querySelector('.inv-equipment')!;
    this.grid = root.querySelector('.inv-grid')!;
    this.groundList = root.querySelector('.ground-list')!;
    this.goldValue = root.querySelector('.inv-gold b')!;
    this.countValue = root.querySelector('.inv-count')!;
    this.tooltip = root.querySelector('.inv-tooltip')!;

    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', () => this.endDrag());
    window.addEventListener('blur', () => this.endDrag());
    root.addEventListener('keydown', (e) => this.keyboardMove(e));
    root.addEventListener('contextmenu', (e) => this.contextMenu(e));
    root.addEventListener('pointerover', (e) => this.hover(e));
    root.addEventListener('pointerout', (e) => {
      if (!(e.relatedTarget as HTMLElement | null)?.closest?.('.inv-item')) this.hideTooltip();
    });
    ItemThumbnails.get().onChange((key, url) => {
      for (const img of root.querySelectorAll<HTMLImageElement>(`img[data-thumb-key="${key}"]`)) {
        img.src = url;
        img.hidden = false;
        img.closest('.inv-item')?.classList.add('inv-has-model');
      }
    });
    root.hidden = true;
  }

  get open(): boolean {
    return this.shown.inventory;
  }

  isOpen(kind: InventoryPanelKind): boolean {
    return this.shown[kind];
  }

  /** The ground window only shows beside the inventory: opening it opens both, closing the inventory closes both. */
  setOpen(kind: InventoryPanelKind, open: boolean): void {
    if (kind === 'ground') {
      this.shown.ground = open;
      if (open) this.shown.inventory = true;
    } else {
      this.shown.inventory = open;
      if (!open) this.shown.ground = false;
    }
    if (!this.shown.inventory) this.endDrag();
    this.root.hidden = !this.shown.inventory;
    this.dock.classList.toggle('ground-open', this.shown.ground);
    this.root.querySelector('.inv-ground-toggle')?.setAttribute('aria-pressed', String(this.shown.ground));
    this.hideTooltip();
    if (this.shown.inventory) this.render();
    if (this.shown.ground) this.renderGround();
  }

  closeAll(): void {
    this.setOpen('inventory', false);
  }

  update(inv: Inventory): void {
    this.inventory = inv;
    this.awaitingUntil = 0;
    if (this.shown.inventory) this.render();
  }

  setGold(gold: number): void {
    this.goldValue.textContent = gold.toLocaleString('en-US');
  }

  setGroundItems(items: readonly GroundItemView[]): void {
    const next = items.map((i) => `${i.id}:${i.quantity}:${i.distance.toFixed(1)}`).join('|');
    if (next === this.groundSignature) return;
    this.groundSignature = next;
    this.ground = [...items];
    if (this.shown.ground) this.renderGround();
  }

  // --- Rendering

  private items(): readonly InventoryItemView[] {
    return this.inventory?.items ?? [];
  }

  private itemBySlot(slot: number): InventoryItemView | undefined {
    return this.items().find((i) => i.slot === slot);
  }

  private itemCard(item: InventoryItemView, placement?: { x: number; y: number }): string {
    const { width, height } = shapeOf(item);
    const position = placement ? ` style="grid-column:${placement.x + 1} / span ${width};grid-row:${placement.y + 1} / span ${height}"` : '';
    const thumbKey = item.model !== undefined ? `${item.model}_${width}x${height}` : '';
    const thumbUrl = item.model !== undefined ? ItemThumbnails.get().getThumbnail(item.model, width, height) : null;
    const hasModel = !!thumbUrl || (item.model !== undefined && itemPreviewModelFile(item.model) !== undefined);
    return `<button type="button" class="inv-item inv-${escape(item.type)}${hasModel ? ' inv-has-model' : ''}" data-slot="${item.slot}"${position} aria-label="${escape(`${item.name}${item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}`)}">
      ${item.model !== undefined ? `<img class="inv-item-thumb" data-thumb-key="${thumbKey}" src="${thumbUrl ?? ''}" alt="" ${thumbUrl ? '' : 'hidden'} />` : ''}
      ${hasModel ? '' : `<span class="inv-mark" aria-hidden="true">${ITEM_MARK[item.type]}</span><span class="inv-item-name">${escape(item.name)}</span>`}${item.quantity && item.quantity > 1 ? `<span class="inv-quantity">${item.quantity}</span>` : ''}
    </button>`;
  }

  private render(): void {
    if (this.drag) {
      this.renderPending = true;
      return;
    }
    this.renderPending = false;
    this.hideTooltip();
    const items = this.items();
    const worn = (kind: string) => items.find((i) => i.equipped && i.type === kind);
    this.equipment.innerHTML = EQUIP_SLOTS.map(({ kind, label, area }) => {
      const item = worn(kind);
      const future = !isEquipKind(kind as InventoryItemView['type']);
      return `<div class="equip-slot${item ? ' occupied' : ''}${future ? ' future' : ''}" data-equip="${kind}" style="grid-area:${area}" ${future ? 'title="Not in this ruleset yet"' : ''}>${item ? this.itemCard(item) : `<span class="equip-label">${label}</span>`}</div>`;
    }).join('') + '<div class="equip-figure" aria-hidden="true"></div>';
    const bag = items.filter((i) => !i.equipped);
    const placed = layoutItemViews(items);
    this.grid.innerHTML = bag.flatMap((item) => {
      const p = placed.get(item.slot);
      return p ? [this.itemCard(item, p)] : [];
    }).join('');
    const hidden = bag.length - placed.size;
    this.countValue.textContent = hidden > 0 ? `${hidden} item${hidden > 1 ? 's' : ''} do not fit` : '';
    this.countValue.classList.toggle('inv-warning', hidden > 0);
  }

  private renderGround(): void {
    this.groundList.innerHTML = this.ground.map((item) => `<button type="button" class="ground-item" data-object="${item.id}" title="Pick up ${escape(item.name)}">
      <span class="inv-mark" aria-hidden="true">◆</span><span class="ground-name"><strong>${escape(item.name)}</strong>${item.quantity > 1 ? ` ×${item.quantity}` : ''}<small>${item.distance.toFixed(1)} m</small></span>
    </button>`).join('') || '<p class="inv-empty">Nothing on the ground nearby.</p>';
  }

  // --- Tooltip

  private tooltipHtml(item: InventoryItemView): string {
    const { width, height } = shapeOf(item);
    const lines: string[] = [];
    item.damage?.forEach((v, i) => v > 0 && lines.push(`${DAMAGE_TYPES[i]![0]}${DAMAGE_TYPES[i]!.slice(1).toLowerCase()} damage: ${v}`));
    if (item.speed !== undefined && item.speed !== 1) lines.push(`Attack speed: ${item.speed}`);
    item.protection?.forEach((v, i) => v < 1 && lines.push(`${DAMAGE_TYPES[i]![0]}${DAMAGE_TYPES[i]!.slice(1).toLowerCase()} taken: ×${v}`));
    if (item.heal) lines.push(`Restores ${item.heal} health`);
    if (item.quantity && item.quantity > 1) lines.push(`Quantity: ${item.quantity}`);
    const hints = [
      isEquipKind(item.type) ? (item.equipped ? 'Click to unequip' : 'Click to equip') : item.type === 'potion' ? 'Click to drink' : '',
      item.quantity && item.quantity > 1 ? 'Right-click to split' : '',
      'Drag outside to drop',
    ].filter(Boolean);
    return `<strong class="tt-name tt-${item.type}">${escape(item.name)}</strong>
      <span class="tt-type">${TYPE_LABEL[item.type]} · ${width}×${height}${item.equipped ? ' · equipped' : ''}</span>
      ${lines.map((l) => `<span>${escape(l)}</span>`).join('')}
      <small>${hints.join(' · ')}</small>`;
  }

  private hover(e: PointerEvent): void {
    if (this.drag || this.press) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.inv-item');
    const item = el && this.itemBySlot(Number(el.dataset['slot']));
    if (!el || !item) return;
    this.tooltip.innerHTML = this.tooltipHtml(item);
    this.tooltip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = this.tooltip.getBoundingClientRect();
    // Beside the item, on the side with room; never off screen.
    const left = r.left - t.width - 8 >= 8 ? r.left - t.width - 8 : Math.min(innerWidth - t.width - 8, r.right + 8);
    const top = Math.max(8, Math.min(innerHeight - t.height - 8, r.top));
    this.tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private hideTooltip(): void {
    this.tooltip.hidden = true;
  }

  // --- Requests (one at a time; the server's reply re-renders and frees the next)

  private request(send: () => void): void {
    if (performance.now() < this.awaitingUntil) return;
    this.awaitingUntil = performance.now() + REQUEST_TIMEOUT_MS;
    send();
  }

  /** Whether the item worn in its slot would fit in the bag once `incoming` leaves it. */
  private swapFits(incoming: InventoryItemView): boolean {
    const prev = this.items().find((i) => i.equipped && i.type === incoming.type && i.slot !== incoming.slot);
    if (!prev) return true;
    const occupied = [...layoutItemViews(this.items().filter((i) => i.slot !== incoming.slot)).values()];
    return firstFreeGridPosition(INVENTORY_GRID, shapeOf(prev), occupied) !== null;
  }

  private click(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement;
    const close = target.closest<HTMLElement>('[data-close]');
    if (close) {
      this.onToggle(close.dataset['close'] as InventoryPanelKind, false);
      return;
    }
    if (target.closest('[data-toggle="ground"]')) {
      this.onToggle('ground', !this.shown.ground);
      return;
    }
    const object = target.closest<HTMLElement>('[data-object]');
    if (object) {
      this.request(() => this.onPickup(Number(object.dataset['object'])));
      return;
    }
    const el = target.closest<HTMLElement>('.inv-item');
    const item = el && this.itemBySlot(Number(el.dataset['slot']));
    if (!item) return;
    if (item.type === 'potion') this.request(() => this.onUse(item.slot, item.itemId));
    else if (!isEquipKind(item.type)) return;
    else if (item.equipped) {
      const occupied = [...layoutItemViews(this.items()).values()];
      if (!firstFreeGridPosition(INVENTORY_GRID, shapeOf(item), occupied)) this.onNotice?.('Inventory full.');
      else this.request(() => this.onEquip(item.slot, item.itemId, false));
    } else if (!this.swapFits(item)) this.onNotice?.('Inventory full.');
    else this.request(() => this.onEquip(item.slot, item.itemId, true));
  }

  private contextMenu(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.inv-grid .inv-item');
    const item = el && this.itemBySlot(Number(el.dataset['slot']));
    if (!item) return;
    e.preventDefault();
    const quantity = item.quantity ?? 1;
    if (quantity >= 2) this.request(() => this.onSplit(item.slot, Math.floor(quantity / 2)));
  }

  // --- Drag and drop

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.drag) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.inv-item');
    const item = el && this.itemBySlot(Number(el.dataset['slot']));
    if (!el || !item) return;
    this.press = { item, source: el, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    e.preventDefault(); // no text selection or native image drag
  }

  private pointerMove(e: PointerEvent): void {
    const press = this.press;
    if (press && e.pointerId === press.pointerId && !this.drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= DRAG_THRESHOLD) this.beginDrag(press);
    if (!this.drag) return;
    this.preview.move(e.clientX, e.clientY);
    this.showDropAction(this.dropAction(e.clientX, e.clientY));
  }

  private pointerUp(e: PointerEvent): void {
    if (this.press?.pointerId !== e.pointerId) return;
    this.press = null;
    if (!this.drag) return; // a plain click: the click handler acts
    const action = this.dropAction(e.clientX, e.clientY);
    const item = this.drag.item;
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
    this.endDrag();
    this.commit(item, action);
  }

  private cellSize(): number {
    return this.grid.getBoundingClientRect().width / INVENTORY_GRID.columns;
  }

  private beginDrag(press: Press): void {
    const { item, source } = press;
    const { width, height } = shapeOf(item);
    const r = source.getBoundingClientRect();
    const grab = {
      x: Math.min(width - 1, Math.max(0, Math.floor(((press.x - r.left) / r.width) * width))),
      y: Math.min(height - 1, Math.max(0, Math.floor(((press.y - r.top) / r.height) * height))),
    };
    const target = document.createElement('span');
    target.className = 'inv-drag-target';
    target.hidden = true;
    this.grid.append(target);
    this.drag = { item, source, grab, target };
    source.classList.add('inv-dragging');
    this.root.classList.add('inv-is-dragging');
    if (isEquipKind(item.type)) this.equipment.querySelector(`[data-equip="${item.type}"]`)?.classList.add('equip-accepts');
    this.hideTooltip();
    const cell = this.cellSize();
    // The grabbed point of the footprint, proportionally (an equipment slot is not footprint-sized).
    this.preview.show({ ...(item.model !== undefined ? { model: item.model } : {}), width, height, glyph: ITEM_MARK[item.type] },
      cell, { x: ((press.x - r.left) / r.width) * width * cell, y: ((press.y - r.top) / r.height) * height * cell });
    this.preview.move(press.x, press.y);
  }

  private endDrag(): void {
    this.press = null;
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.target.remove();
    drag.source.classList.remove('inv-dragging');
    this.root.classList.remove('inv-is-dragging');
    this.root.querySelectorAll('.drop-hover, .drop-invalid, .equip-accepts').forEach((el) => el.classList.remove('drop-hover', 'drop-invalid', 'equip-accepts'));
    this.preview.hide();
    if (this.renderPending) this.render();
  }

  /** Grid origin for the dragged item with the cursor at (x, y), or null off the grid. */
  private gridOrigin(x: number, y: number): { x: number; y: number } | null {
    const drag = this.drag!;
    const r = this.grid.getBoundingClientRect();
    const cell = r.width / INVENTORY_GRID.columns;
    const cx = Math.floor((x - r.left) / cell), cy = Math.floor((y - r.top) / (r.height / INVENTORY_GRID.rows));
    if (cx < 0 || cy < 0 || cx >= INVENTORY_GRID.columns || cy >= INVENTORY_GRID.rows) return null;
    return { x: cx - drag.grab.x, y: cy - drag.grab.y };
  }

  private dropAction(x: number, y: number): DropAction {
    const drag = this.drag;
    if (!drag) return { kind: 'none' };
    const item = drag.item;
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!under?.closest('.inv-main')) return { kind: 'drop' }; // the ground window, or anywhere outside
    const shape = shapeOf(item);
    if (under.closest('.inv-equipment')) {
      if (item.equipped || !isEquipKind(item.type)) return { kind: 'none' };
      return { kind: 'equip', slot: item.slot, valid: this.swapFits(item) };
    }
    const at = this.gridOrigin(x, y);
    if (!at) return { kind: 'none' };
    const onto = under.closest<HTMLElement>('.inv-grid .inv-item');
    const other = onto && this.itemBySlot(Number(onto.dataset['slot']));
    if (other && other.slot !== item.slot) {
      // Onto a stack of the same item: merge. A worn item onto one of its kind: wear that one instead.
      if (!item.equipped && other.itemId === item.itemId && (other.quantity ?? 1) + (item.quantity ?? 1) <= 99 && item.type === 'potion') return { kind: 'merge', toSlot: other.slot };
      if (item.equipped && other.type === item.type) return { kind: 'equip', slot: other.slot, valid: this.swapFits(other) };
    }
    const placed = layoutItemViews(this.items());
    const occupied = [...placed].filter(([slot]) => slot !== item.slot).map(([, p]) => p);
    const valid = canPlaceGrid(INVENTORY_GRID, { ...at, ...shape }, occupied);
    return item.equipped ? { kind: 'unequip', ...at, valid } : { kind: 'move', ...at, valid };
  }

  private showDropAction(action: DropAction): void {
    const drag = this.drag!;
    const { width, height } = shapeOf(drag.item);
    const target = drag.target;
    const onGrid = action.kind === 'move' || action.kind === 'unequip';
    target.hidden = !onGrid;
    if (onGrid) {
      // Clamped to the grid so an origin hanging over an edge still shows (as invalid).
      const x = Math.max(0, Math.min(INVENTORY_GRID.columns - width, action.x));
      const y = Math.max(0, Math.min(INVENTORY_GRID.rows - height, action.y));
      target.style.gridColumn = `${x + 1} / span ${width}`;
      target.style.gridRow = `${y + 1} / span ${height}`;
      target.classList.toggle('valid', action.valid);
      target.classList.toggle('invalid', !action.valid);
    }
    const ground = this.root.querySelector('.inv-ground');
    ground?.classList.toggle('drop-hover', action.kind === 'drop' && this.shown.ground);
    const slot = isEquipKind(drag.item.type) ? this.equipment.querySelector(`[data-equip="${drag.item.type}"]`) : null;
    const equipping = action.kind === 'equip';
    slot?.classList.toggle('drop-hover', equipping && action.valid);
    slot?.classList.toggle('drop-invalid', equipping && !action.valid);
    this.grid.querySelectorAll('.inv-item.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
    const mergeInto = action.kind === 'merge' ? action.toSlot : action.kind === 'equip' && action.slot !== drag.item.slot ? action.slot : null;
    if (mergeInto !== null) this.grid.querySelector(`[data-slot="${mergeInto}"]`)?.classList.add('drop-hover');
  }

  private commit(item: InventoryItemView, action: DropAction): void {
    switch (action.kind) {
      case 'drop':
        this.request(() => this.onDrop(item.slot, item.itemId));
        return;
      case 'merge':
        this.request(() => this.onMerge(item.slot, action.toSlot));
        return;
      case 'equip': {
        const wear = this.itemBySlot(action.slot);
        if (!wear) return;
        if (!action.valid) this.onNotice?.('Inventory full.');
        else this.request(() => this.onEquip(wear.slot, wear.itemId, true));
        return;
      }
      case 'move': {
        const at = layoutItemViews(this.items()).get(item.slot);
        if (action.valid && (at?.x !== action.x || at?.y !== action.y)) this.request(() => this.onMove(item.slot, item.itemId, action.x, action.y));
        return;
      }
      case 'unequip':
        if (action.valid) this.request(() => this.onEquip(item.slot, item.itemId, false, { x: action.x, y: action.y }));
        return;
      case 'none':
    }
  }

  /** Keyboard alternative to dragging: arrow keys move the focused rectangle one cell. */
  private keyboardMove(e: KeyboardEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.inv-grid .inv-item');
    const item = el && this.itemBySlot(Number(el.dataset['slot']));
    const delta = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null;
    if (!item || !delta) return;
    e.preventDefault();
    const placed = layoutItemViews(this.items());
    const at = placed.get(item.slot);
    if (!at) return;
    const next: GridPlacement = { ...at, x: at.x + delta[0]!, y: at.y + delta[1]! };
    const occupied = [...placed].filter(([slot]) => slot !== item.slot).map(([, p]) => p);
    if (canPlaceGrid(INVENTORY_GRID, next, occupied)) this.request(() => this.onMove(item.slot, item.itemId, next.x, next.y));
  }
}
