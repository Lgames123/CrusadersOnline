import { canPlaceGrid, DAMAGE_TYPES, firstFreeGridPosition, INVENTORY_GRID, type GridPlacement, type Inventory, type InventoryItemView } from '@crusaders/shared';
import { HeldItemPreview } from './held_item_preview.ts';
import { ItemThumbnails } from './item_thumbnails.ts';
import { itemPreviewModelFile } from '../assets/item_models.ts';

export type InventoryPanelKind = 'bag' | 'character' | 'ground';

export interface GroundItemView {
  id: number;
  name: string;
  quantity: number;
  distance: number;
}

const ITEM_MARK: Record<InventoryItemView['type'], string> = {
  weapon: '⚔', shield: '◈', armor: '♜', potion: '⚗', spellbook: '✦', key: '⚿',
};

function describe(item: InventoryItemView): string {
  const parts: string[] = [`${item.width ?? 1}×${item.height ?? 1} cells`];
  item.damage?.forEach((v, i) => v > 0 && parts.push(`${v} ${DAMAGE_TYPES[i]!.toLowerCase()}`));
  if (item.speed !== undefined && item.speed !== 1) parts.push(`speed ${item.speed}`);
  item.protection?.forEach((v, i) => v < 1 && parts.push(`${DAMAGE_TYPES[i]!.toLowerCase()} ×${v}`));
  if (item.heal) parts.push(`heals ${item.heal}`);
  return parts.join(' · ');
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Three independently toggled inventory surfaces. The bag uses the resolved Width/Height from
 * items.ctx; until the x/y migration lands, legacy slot records are packed deterministically for
 * presentation only and every mutation still goes through the existing server commands.
 */
export class InventoryPanels {
  private readonly root: HTMLElement;
  private inventory: Inventory | null = null;
  private ground: GroundItemView[] = [];
  private readonly shown: Record<InventoryPanelKind, boolean> = { bag: false, character: false, ground: false };
  private groundSignature = '';
  private drag: { slot: number; width: number; height: number; grid: HTMLElement; target: HTMLElement } | null = null;
  private readonly preview = new HeldItemPreview();
  private suppressItemClick = false;

  onToggleEquip: (slot: number, equip: boolean) => void = () => {};
  onMove: (slot: number, x: number, y: number) => void = () => {};
  onMerge: (fromSlot: number, toSlot: number) => void = () => {};
  onSplit: (slot: number, quantity: number) => void = () => {};
  onPickup: (object: number) => void = () => {};
  onDrop: (slot: number) => void = () => {};
  onClose: (kind: InventoryPanelKind) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => {
      if (this.suppressItemClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = e.target as HTMLElement;
      const slot = target.closest<HTMLElement>('[data-slot]');
      const object = target.closest<HTMLElement>('[data-object]');
      const close = target.closest<HTMLElement>('[data-close]');
      if (slot) this.onToggleEquip(Number(slot.dataset['slot']), slot.dataset['equipped'] !== 'true');
      else if (object) this.onPickup(Number(object.dataset['object']));
      else if (close) this.onClose(close.dataset['close'] as InventoryPanelKind);
    });
    root.addEventListener('pointerdown', (e) => this.startDrag(e));
    root.addEventListener('pointermove', (e) => this.updateDrag(e));
    root.addEventListener('pointerup', (e) => this.finishDrag(e));
    root.addEventListener('pointercancel', () => this.cancelDrag());
    root.addEventListener('keydown', (e) => this.keyboardMove(e));
    root.addEventListener('contextmenu', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('.inv-grid .inv-item');
      const quantity = Number(item?.dataset['quantity'] ?? 1);
      if (!item || quantity < 2) return;
      e.preventDefault();
      this.onSplit(Number(item.dataset['slot']), Math.floor(quantity / 2));
    });
    ItemThumbnails.get().onChange((key, url) => {
      const imgs = this.root.querySelectorAll<HTMLImageElement>(`img[data-thumb-key="${key}"]`);
      for (const img of imgs) {
        img.src = url;
        img.hidden = false;
        img.closest('.inv-item')?.classList.add('inv-has-model');
      }
    });
  }

  get open(): boolean {
    return this.shown.bag || this.shown.character || this.shown.ground;
  }

  isOpen(kind: InventoryPanelKind): boolean {
    return this.shown[kind];
  }

  setOpen(kind: InventoryPanelKind, open: boolean): void {
    if (this.shown[kind] === open) return;
    this.shown[kind] = open;
    this.root.hidden = !this.open;
    if (this.open) this.render();
  }

  closeAll(): void {
    if (!this.open) return;
    this.shown.bag = this.shown.character = this.shown.ground = false;
    this.root.hidden = true;
  }

  update(inv: Inventory): void {
    this.inventory = inv;
    if (this.open) this.render();
  }

  setGroundItems(items: readonly GroundItemView[]): void {
    const next = items.map((i) => `${i.id}:${i.quantity}:${i.distance.toFixed(1)}`).join('|');
    if (next === this.groundSignature) return;
    this.groundSignature = next;
    this.ground = [...items];
    if (this.shown.ground) this.render();
  }

  private itemCard(item: InventoryItemView, placement?: { x: number; y: number }): string {
    const width = Math.max(1, item.width ?? 1);
    const height = Math.max(1, item.height ?? 1);
    const position = placement ? ` style="grid-column:${placement.x + 1} / span ${width};grid-row:${placement.y + 1} / span ${height}"` : '';
    const action = item.equipped ? 'Unequip' : item.type === 'potion' ? 'Drink' : 'Equip';
    const thumbKey = item.model !== undefined ? `${item.model}_${width}x${height}` : '';
    const thumbUrl = item.model !== undefined ? ItemThumbnails.get().getThumbnail(item.model, width, height) : null;
    const hasModel = !!thumbUrl || (item.model !== undefined && itemPreviewModelFile(item.model) !== undefined);
    return `<button type="button" class="inv-item inv-${escape(item.type)}${hasModel ? ' inv-has-model' : ''}" data-slot="${item.slot}" data-item-id="${escape(item.itemId)}" data-quantity="${item.quantity ?? 1}" data-equipped="${item.equipped}" data-width="${width}" data-height="${height}"${placement ? ` data-x="${placement.x}" data-y="${placement.y}"` : ''}${item.model !== undefined ? ` data-model="${item.model}"` : ''}${position} title="${escape(`${item.name} — ${describe(item)}. ${action}.`)}" aria-label="${escape(`${item.name}, ${describe(item)}. ${action}`)}">
      ${item.model !== undefined ? `<img class="inv-item-thumb" data-thumb-key="${thumbKey}" src="${thumbUrl ?? ''}" alt="" ${thumbUrl ? '' : 'hidden'} />` : ''}
      ${hasModel ? '' : `<span class="inv-mark" aria-hidden="true">${ITEM_MARK[item.type]}</span>`}<span class="inv-item-name">${escape(item.name)}</span>${item.quantity && item.quantity > 1 ? `<span class="inv-quantity">×${item.quantity}</span>` : ''}
    </button>`;
  }

  private bag(): string {
    const bag = (this.inventory?.items ?? []).filter((item) => !item.equipped);
    const occupied: GridPlacement[] = [];
    const placed = new Map<number, { item: InventoryItemView; x: number; y: number }>();
    // Keep authoritative coordinates first, then pack pre-migration records around them.
    for (const item of [...bag].sort((a, b) => a.slot - b.slot)) {
      const width = Math.max(1, item.width ?? 1), height = Math.max(1, item.height ?? 1);
      const saved = item.x === undefined || item.y === undefined ? null : { x: item.x, y: item.y, width, height };
      const at = saved && canPlaceGrid(INVENTORY_GRID, saved, occupied) ? saved : null;
      if (at) (occupied.push(at), placed.set(item.slot, { item, x: at.x, y: at.y }));
    }
    for (const item of [...bag].sort((a, b) => a.slot - b.slot)) {
      if (placed.has(item.slot)) continue;
      const width = Math.max(1, item.width ?? 1), height = Math.max(1, item.height ?? 1);
      const at = firstFreeGridPosition(INVENTORY_GRID, { width, height }, occupied);
      if (at) (occupied.push({ ...at, width, height }), placed.set(item.slot, { item, ...at }));
    }
    const cards = [...placed.values()].map((entry) => this.itemCard(entry.item, entry)).join('');
    const overflow = placed.size !== bag.length;
    return `<section class="inv-surface inv-bag" ${this.shown.bag ? '' : 'hidden'} aria-label="Inventory">
      <div class="inv-head"><div><h2>Inventory</h2><span>Shift+I · ${bag.length} items</span></div><button type="button" class="secondary" data-close="bag" aria-label="Close inventory">×</button></div>
      <div class="inv-grid" style="--inv-columns:${INVENTORY_GRID.columns};--inv-rows:${INVENTORY_GRID.rows}">${cards}</div>
      ${overflow ? '<p class="inv-warning">Some legacy items do not fit this visual layout yet.</p>' : '<p class="inv-help">Drag an item, use arrows to move it, or drop outside to throw on the ground.</p>'}
    </section>`;
  }

  private equipmentSlot(label: string, item: InventoryItemView | undefined, future = false): string {
    return `<div class="equip-slot ${item ? 'occupied' : ''} ${future ? 'future' : ''}"><span>${label}</span>${item ? this.itemCard(item) : `<em>${future ? 'Future slot' : 'Empty'}</em>`}</div>`;
  }

  private character(): string {
    const equipped = this.inventory?.items.filter((item) => item.equipped) ?? [];
    const find = (type: InventoryItemView['type']) => equipped.find((item) => item.type === type);
    return `<section class="inv-surface inv-character" ${this.shown.character ? '' : 'hidden'} aria-label="Character equipment">
      <div class="inv-head"><div><h2>Character</h2><span>Shift+C · equipment</span></div><button type="button" class="secondary" data-close="character" aria-label="Close character equipment">×</button></div>
      <div class="paperdoll">
        ${this.equipmentSlot('Weapon', find('weapon'))}
        ${this.equipmentSlot('Head', undefined, true)}
        ${this.equipmentSlot('Shield', find('shield'))}
        <div class="character-silhouette" aria-label="Character silhouette">♟</div>
        ${this.equipmentSlot('Armour', find('armor'))}
        ${this.equipmentSlot('Ring I', undefined, true)}
        ${this.equipmentSlot('Boots', undefined, true)}
        ${this.equipmentSlot('Ring II', undefined, true)}
      </div>
      <p class="inv-help">Only weapon, shield and armour are active in the current ruleset.</p>
    </section>`;
  }

  private groundItems(): string {
    const rows = this.ground.map((item) => `<button type="button" class="ground-item" data-object="${item.id}" title="Pick up ${escape(item.name)}">
      <span class="inv-mark" aria-hidden="true">◆</span><span><strong>${escape(item.name)}</strong>${item.quantity > 1 ? ` ×${item.quantity}` : ''}<small>${item.distance.toFixed(1)} m away</small></span><b>Pick up</b>
    </button>`).join('');
    return `<section class="inv-surface inv-ground" ${this.shown.ground ? '' : 'hidden'} aria-label="Nearby ground items">
      <div class="inv-head"><div><h2>Ground items</h2><span>Shift+G · nearby loot</span></div><button type="button" class="secondary" data-close="ground" aria-label="Close ground items">×</button></div>
      <div class="ground-list">${rows || '<p class="inv-empty">No items nearby.</p>'}</div>
      <p class="inv-help">Pick up remains validated by the server for distance and space.</p>
    </section>`;
  }

  private render(): void {
    this.root.innerHTML = `${this.bag()}${this.character()}${this.groundItems()}`;
  }

  private startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('.inv-grid .inv-item');
    const grid = item?.closest<HTMLElement>('.inv-grid');
    if (!item || !grid) return;
    const target = document.createElement('span');
    target.className = 'inv-drag-target';
    grid.append(target);
    this.drag = { slot: Number(item.dataset['slot']), width: Number(item.dataset['width']), height: Number(item.dataset['height']), grid, target };
    item.classList.add('inv-dragging');
    this.preview.show(this.root, item.dataset['model'] === undefined ? undefined : Number(item.dataset['model']));
    this.root.setPointerCapture(e.pointerId);
    this.updateDrag(e);
    e.preventDefault();
  }

  private dragPosition(e: PointerEvent): { x: number; y: number } | null {
    const drag = this.drag;
    if (!drag) return null;
    const r = drag.grid.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / INVENTORY_GRID.columns));
    const y = Math.floor((e.clientY - r.top) / (r.height / INVENTORY_GRID.rows));
    return x >= 0 && y >= 0 && x < INVENTORY_GRID.columns && y < INVENTORY_GRID.rows ? { x, y } : null;
  }

  private updateDrag(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.preview.move(e.clientX, e.clientY);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const overGround = !!under?.closest('.inv-ground');
    const insideBag = !!under?.closest('.inv-bag');
    this.root.querySelector('.inv-ground')?.classList.toggle('drop-hover', overGround);

    if (overGround || !insideBag) {
      drag.target.hidden = true;
      drag.grid.classList.remove('drag-valid', 'drag-invalid');
      return;
    }

    const at = this.dragPosition(e);
    const candidate = at && { x: at.x, y: at.y, width: drag.width, height: drag.height };
    const occupied = [...drag.grid.querySelectorAll<HTMLElement>('.inv-item')]
      .filter((item) => Number(item.dataset['slot']) !== drag.slot)
      .map((item) => ({ x: Number(item.dataset['x']), y: Number(item.dataset['y']), width: Number(item.dataset['width']), height: Number(item.dataset['height']) }));
    const valid = !!candidate && canPlaceGrid(INVENTORY_GRID, candidate, occupied);
    if (candidate) {
      drag.target.style.gridColumn = `${candidate.x + 1} / span ${candidate.width}`;
      drag.target.style.gridRow = `${candidate.y + 1} / span ${candidate.height}`;
      drag.target.hidden = false;
    } else drag.target.hidden = true;
    drag.target.classList.toggle('valid', valid);
    drag.target.classList.toggle('invalid', !!candidate && !valid);
    drag.grid.classList.toggle('drag-valid', valid);
    drag.grid.classList.toggle('drag-invalid', !!candidate && !valid);
  }

  private finishDrag(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const overGround = !!under?.closest('.inv-ground');
    const insideBag = !!under?.closest('.inv-bag');
    if (overGround || !insideBag) {
      this.onDrop(drag.slot);
    } else {
      const at = this.dragPosition(e);
      const occupied = [...drag.grid.querySelectorAll<HTMLElement>('.inv-item')]
        .filter((item) => Number(item.dataset['slot']) !== drag.slot)
        .map((item) => ({ x: Number(item.dataset['x']), y: Number(item.dataset['y']), width: Number(item.dataset['width']), height: Number(item.dataset['height']) }));
      const next = at && { x: at.x, y: at.y, width: drag.width, height: drag.height };
      const underPointer = under?.closest<HTMLElement>('.inv-grid .inv-item');
      if (underPointer && Number(underPointer.dataset['slot']) !== drag.slot && underPointer.dataset['itemId'] === drag.grid.querySelector<HTMLElement>(`[data-slot="${drag.slot}"]`)?.dataset['itemId']) {
        this.onMerge(drag.slot, Number(underPointer.dataset['slot']));
      } else if (next && canPlaceGrid(INVENTORY_GRID, next, occupied)) this.onMove(drag.slot, at!.x, at!.y);
    }
    this.suppressItemClick = true;
    queueMicrotask(() => { this.suppressItemClick = false; });
    this.cancelDrag();
  }

  private cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.root.querySelector('.inv-ground')?.classList.remove('drop-hover');
    this.root.querySelectorAll('.inv-dragging').forEach((el) => el.classList.remove('inv-dragging'));
    drag.grid.classList.remove('drag-valid', 'drag-invalid');
    drag.target.remove();
    this.preview.hide();
    this.drag = null;
  }

  /** Keyboard alternative to dragging: arrow keys move the focused rectangle one cell. */
  private keyboardMove(e: KeyboardEvent): void {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.inv-grid .inv-item');
    if (!item) return;
    const delta = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null;
    if (!delta) return;
    e.preventDefault();
    const grid = item.closest<HTMLElement>('.inv-grid');
    if (!grid) return;
    const slot = Number(item.dataset['slot']);
    const next = { x: Number(item.dataset['x']) + delta[0]!, y: Number(item.dataset['y']) + delta[1]!, width: Number(item.dataset['width']), height: Number(item.dataset['height']) };
    const occupied = [...grid.querySelectorAll<HTMLElement>('.inv-item')]
      .filter((other) => Number(other.dataset['slot']) !== slot)
      .map((other) => ({ x: Number(other.dataset['x']), y: Number(other.dataset['y']), width: Number(other.dataset['width']), height: Number(other.dataset['height']) }));
    if (canPlaceGrid(INVENTORY_GRID, next, occupied)) this.onMove(slot, next.x, next.y);
  }
}
