import { affixLines, modsTitle, moddable, nextRefine, refineChance, withoutAffixes, BUILTIN_ITEMS, BUILTIN_SPELLS, canPlaceGrid, DAMAGE_TYPES, equipCapacity, firstFreeGridPosition, isEquippable, INVENTORY_GRID, layoutItemViews, SPELL_NAMES, type GridPlacement, type Inventory, type InventoryItemView, type ItemMods, type PlayerStats, type ShopItemView, type SpellId } from '@crusaders/shared';
import { HeldItemPreview } from './held_item_preview.ts';
import { ItemThumbnails } from './item_thumbnails.ts';
import { itemPreviewModelFile } from '../assets/item_models.ts';
import { HOTBAR_ITEM_TYPES } from './hotbar.ts';
import { spellIconUrl } from './spell_icons.ts';

/** The inventory window (character equipment over the bag) and the ground window beside it. */
export type InventoryPanelKind = 'inventory' | 'ground';

export interface GroundItemView {
  id: number;
  name: string;
  quantity: number;
  distance: number;
  /** Its rarity / affixes / refinement (MMO): the name takes the rarity's colour. */
  mods?: ItemMods;
}

type ItemType = InventoryItemView['type'];
/** A paper-doll slot: the item type it takes, the two ring slots apart. */
type EquipSlotKind = Exclude<ItemType, 'potion' | 'spellbook' | 'key' | 'ring' | 'material'> | 'ring1' | 'ring2';

const ITEM_MARK: Record<ItemType, string> = {
  weapon: '⚔', shield: '◈', armor: '♜', potion: '⚗', spellbook: '✦', key: '⚿',
  ring: '◯', amulet: '❖', helm: '⛑', gloves: '✋', belt: '▬', boots: '⛸', material: '◆',
};

const TYPE_LABEL: Record<ItemType, string> = {
  weapon: 'Weapon', shield: 'Shield', armor: 'Armour', potion: 'Potion', spellbook: 'Spell book', key: 'Quest item',
  ring: 'Ring', amulet: 'Amulet', helm: 'Helm', gloves: 'Gloves', belt: 'Belt', boots: 'Boots', material: 'Material',
};

const ATTRIBUTE_LABEL: Record<string, string> = { might: 'Might', intellect: 'Intellect', endurance: 'Endurance', speed: 'Speed' };

/**
 * Paper-doll slots on the 8-cell-wide, 6-row equipment board (MU Online's layout around the
 * body), as grid-area row / column / row span / column span (the amulet slot is 2×1). Two rings
 * are worn, shown in inventory slot order.
 */
const EQUIP_SLOTS: { kind: EquipSlotKind; label: string; area: string }[] = [
  { kind: 'ring1', label: 'Ring', area: '1 / 1 / span 1 / span 1' },
  { kind: 'ring2', label: 'Ring', area: '1 / 2 / span 1 / span 1' },
  { kind: 'helm', label: 'Helm', area: '1 / 4 / span 2 / span 2' },
  { kind: 'amulet', label: 'Amulet', area: '1 / 7 / span 1 / span 2' },
  { kind: 'weapon', label: 'Weapon', area: '2 / 1 / span 3 / span 2' },
  { kind: 'armor', label: 'Armour', area: '3 / 4 / span 3 / span 2' },
  { kind: 'shield', label: 'Shield', area: '2 / 7 / span 3 / span 2' },
  { kind: 'gloves', label: 'Gloves', area: '5 / 1 / span 2 / span 2' },
  { kind: 'belt', label: 'Belt', area: '6 / 4 / span 1 / span 2' },
  { kind: 'boots', label: 'Boots', area: '5 / 7 / span 2 / span 2' },
];

/**
 * Bag page, Key Items page (the original's "Quest Items" page, 0x472C20) or the known spells
 * (not original: where spells are dragged to the hotbar from) under the equipment.
 */
type InventoryPage = 'bag' | 'keys' | 'spells';
/** Key items are drawn larger than their 1Ã—1 footprint: this many cells a side, four to a row. */
const KEY_TILE = 2;

/** How far (CSS px) the pointer travels before a press on an item becomes a drag. */
const DRAG_THRESHOLD = 5;
/** A sent request blocks further item actions until the server answers (or this long). */
const REQUEST_TIMEOUT_MS = 1500;

/** The paper-doll slots an item type goes in. */
function equipSlotsOf(type: ItemType): string[] {
  return type === 'ring' ? ['ring1', 'ring2'] : isEquippable(type) ? [type] : [];
}

function equipSelector(type: ItemType): string {
  return equipSlotsOf(type).map((k) => `[data-equip="${k}"]`).join(', ') || ':not(*)';
}

/** "Item level: 42" under a tooltip's name (rolled gear only; area_levels.ts). */
function itemLevelLine(mods: ItemMods | undefined): string {
  return mods?.ilvl ? `<span class="tt-ilvl">Item level: ${mods.ilvl}</span>` : '';
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function shapeOf(item: { width?: number; height?: number }): { width: number; height: number } {
  return { width: Math.max(1, item.width ?? 1), height: Math.max(1, item.height ?? 1) };
}

/** What releasing the dragged item here would do. */
type DropAction =
  | { kind: 'none' }
  | { kind: 'drop' }
  | { kind: 'sell' }
  | { kind: 'move'; x: number; y: number; valid: boolean }
  | { kind: 'merge'; toSlot: number }
  | { kind: 'equip'; slot: number; valid: boolean }
  | { kind: 'unequip'; x: number; y: number; valid: boolean }
  | { kind: 'hotbar'; slot: number };

/** Where items dragged out of the bag can be put on the hotbar. */
export interface HotbarDropTarget {
  slotAt(x: number, y: number): number | null;
  highlight(slot: number | null): void;
}

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
  private readonly keys: HTMLElement;
  private readonly spells: HTMLElement;
  private spellStats: Pick<PlayerStats, 'spells' | 'spell'> | null = null;
  /** Where a spell tile was pressed: a click that ends a drag does not select it. */
  private spellPress: { x: number; y: number } | null = null;
  private page: InventoryPage = 'bag';
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
  private readonly shopWindow: HTMLElement;
  private readonly shopList: HTMLElement;
  /** The shop open (its trigger id) and this visit's offer, or null. */
  private shop: { shop: number; stock: ShopItemView[]; gift: boolean } | null = null;
  private gold = 0;

  onEquip: (slot: number, itemId: string, equip: boolean, to?: { x: number; y: number }) => void = () => {};
  /** The anvil button on a merchant's window (MMO Stage 6, with mmoCrafting). */
  onAnvil: () => void = () => {};
  set anvil(on: boolean) {
    this.root.querySelector<HTMLElement>('.shop-anvil')!.hidden = !on;
  }
  /** The auction house button on a merchant's window (MMO Stage 4). */
  onAuction: () => void = () => {};
  /** MMO items: refinement offered (the server's `mmoItems`), and one attempt asked (Shift-click at a merchant). */
  refining = false;
  onRefine: (slot: number, itemId: string) => void = () => {};
  onUse: (slot: number, itemId: string) => void = () => {};
  onMove: (slot: number, itemId: string, x: number, y: number) => void = () => {};
  onMerge: (fromSlot: number, toSlot: number) => void = () => {};
  onSplit: (slot: number, quantity: number) => void = () => {};
  onPickup: (object: number) => void = () => {};
  onDrop: (slot: number, itemId: string) => void = () => {};
  /** Shops: buy `quantity` of a stocked item, sell the item (stack) in a bag slot, the shop closed. */
  onBuy: (shop: number, index: number, itemId: string) => void = () => {};
  onSell: (shop: number, slot: number, itemId: string) => void = () => {};
  onShopClosed: () => void = () => {};
  /** The player asked to open or close a window (button, ×). */
  onToggle: (kind: InventoryPanelKind, open: boolean) => void = () => {};
  onNotice?: (message: string) => void;
  /** Hotbar: drops of potions and gear onto it, spells dragged from the Spells page, a spell clicked (selected for R). */
  hotbar: HotbarDropTarget | null = null;
  onHotbar: (slot: number, item: InventoryItemView) => void = () => {};
  onSpellDrag: (spell: SpellId, e: PointerEvent) => void = () => {};
  onSelectSpell: (spell: SpellId) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `<div class="inv-dock">
      <section class="inv-window inv-main" aria-label="Inventory">
        <header class="inv-title"><h2>Inventory</h2><button type="button" class="inv-x" data-close="inventory" aria-label="Close inventory">×</button></header>
        <div class="inv-equipment" aria-label="Equipment"></div>
        <nav class="inv-pages" role="tablist" aria-label="Inventory pages">
          <button type="button" role="tab" data-page="bag" aria-selected="true">Bag</button>
          <button type="button" role="tab" data-page="keys" aria-selected="false">Key Items <span class="inv-page-count"></span></button>
          <button type="button" role="tab" data-page="spells" aria-selected="false">Spells</button>
        </nav>
        <div class="inv-grid" style="--inv-columns:${INVENTORY_GRID.columns};--inv-rows:${INVENTORY_GRID.rows}" aria-label="Bag"></div>
        <div class="inv-keys" style="--inv-columns:${INVENTORY_GRID.columns};--inv-rows:${INVENTORY_GRID.rows}" aria-label="Key items" hidden></div>
        <div class="inv-keys inv-spells" style="--inv-columns:${INVENTORY_GRID.columns};--inv-rows:${INVENTORY_GRID.rows}" aria-label="Spells" hidden></div>
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
      <section class="inv-window inv-shop" aria-label="Shop" hidden>
        <header class="inv-title"><h2 class="shop-title">Merchant</h2><button type="button" class="inv-x shop-ah" data-auction="1" title="Auction house and mailbox" aria-label="Auction house">⚖</button><button type="button" class="inv-x shop-anvil" data-anvil="1" title="Smithing and salvaging" aria-label="Anvil" hidden>⚒</button><button type="button" class="inv-x" data-close="shop" aria-label="Close shop">×</button></header>
        <div class="shop-list"></div>
        <p class="inv-help">Click to buy. Right-click or drag a bag item here to sell it.</p>
      </section>
    </div>
    <div class="inv-tooltip" role="tooltip" hidden></div>`;
    this.dock = root.querySelector('.inv-dock')!;
    this.equipment = root.querySelector('.inv-equipment')!;
    this.grid = root.querySelector('.inv-grid')!;
    this.keys = root.querySelector('.inv-keys')!;
    this.spells = root.querySelector('.inv-spells')!;
    this.groundList = root.querySelector('.ground-list')!;
    this.goldValue = root.querySelector('.inv-gold b')!;
    this.countValue = root.querySelector('.inv-count')!;
    this.tooltip = root.querySelector('.inv-tooltip')!;
    this.shopWindow = root.querySelector('.inv-shop')!;
    this.shopList = root.querySelector('.shop-list')!;

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
      if (!(e.relatedTarget as HTMLElement | null)?.closest?.('.inv-item, [data-spell], .ground-item')) this.hideTooltip();
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
    if (!this.shown.inventory) {
      this.endDrag();
      this.closeShop();
    }
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

  /** Known spells and the selected one (PLAYER_STATS), for the Spells page. */
  setSpells(stats: Pick<PlayerStats, 'spells' | 'spell'>): void {
    const changed = stats.spell !== this.spellStats?.spell || JSON.stringify(stats.spells) !== JSON.stringify(this.spellStats?.spells);
    this.spellStats = { spells: stats.spells, spell: stats.spell };
    if (changed && this.shown.inventory && this.page === 'spells') this.render();
  }

  setGold(gold: number): void {
    this.gold = gold;
    this.goldValue.textContent = gold.toLocaleString('en-US');
    if (this.shop) this.renderShop();
  }

  /** The shop open (its trigger id), or null. */
  get shopId(): number | null {
    return this.shop?.shop ?? null;
  }

  /** Opens a shop beside the inventory (which opens too), or shows its offer after a trade. */
  openShop(shop: { shop: number; stock: ShopItemView[]; gift?: boolean }): void {
    this.shop = { shop: shop.shop, stock: [...shop.stock], gift: shop.gift === true };
    this.shopWindow.querySelector('.shop-title')!.textContent = this.shop.gift ? 'Reward' : 'Merchant';
    this.awaitingUntil = 0;
    this.shopWindow.hidden = false;
    this.dock.classList.add('shop-open');
    if (!this.shown.inventory) this.setOpen('inventory', true);
    this.renderShop();
  }

  closeShop(): void {
    if (!this.shop) return;
    this.shop = null;
    this.shopWindow.hidden = true;
    this.dock.classList.remove('shop-open');
    this.hideTooltip();
    this.onShopClosed();
  }

  private renderShop(): void {
    const shop = this.shop;
    if (!shop) return;
    this.shopList.innerHTML = shop.stock.map((item, i) => {
      const { width, height } = shapeOf(item);
      const thumbKey = item.model !== undefined ? ItemThumbnails.key(item.model, width, height, item.texture) : '';
      const thumbUrl = item.model !== undefined ? ItemThumbnails.get().getThumbnail(item.model, width, height, item.texture) : null;
      const poor = item.price > this.gold;
      const name = `${item.name}${item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}`;
      return `<button type="button" class="shop-item inv-${escape(item.type)}${poor ? ' shop-poor' : ''}" data-stock="${i}" title="${escape(shop.gift ? `Take ${name}` : `Buy ${name} for ${item.price} gold`)}">
        <span class="shop-thumb">${item.model !== undefined ? `<img data-thumb-key="${thumbKey}" src="${thumbUrl ?? ''}" alt="" ${thumbUrl ? '' : 'hidden'} />` : ''}<span class="inv-mark" aria-hidden="true">${ITEM_MARK[item.type]}</span></span>
        <span class="shop-name">${escape(name)}<small>${TYPE_LABEL[item.type]}</small></span>
        <span class="shop-price">${shop.gift ? 'Free' : `<i aria-hidden="true"></i>${item.price.toLocaleString('en-US')}`}</span>
      </button>`;
    }).join('') || `<p class="inv-empty">${shop.gift ? 'Nothing left to take.' : 'Nothing for sale.'}</p>`;
  }

  setGroundItems(items: readonly GroundItemView[]): void {
    const next = items.map((i) => `${i.id}:${i.quantity}:${i.distance.toFixed(1)}`).join('|');
    if (next === this.groundSignature) return;
    this.groundSignature = next;
    // An item picked up (or gone) under the pointer takes its tooltip with it.
    if (this.ground.some((g) => !items.some((i) => i.id === g.id))) this.hideTooltip();
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
    const thumbKey = item.model !== undefined ? ItemThumbnails.key(item.model, width, height, item.texture) : '';
    const thumbUrl = item.model !== undefined ? ItemThumbnails.get().getThumbnail(item.model, width, height, item.texture) : null;
    const hasModel = !!thumbUrl || (item.model !== undefined && itemPreviewModelFile(item.model) !== undefined);
    return `<button type="button" class="inv-item inv-${escape(item.type)}${hasModel ? ' inv-has-model' : ''}" data-slot="${item.slot}"${position} aria-label="${escape(`${item.name}${item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}`)}">
      ${item.model !== undefined ? `<img class="inv-item-thumb" data-thumb-key="${thumbKey}" src="${thumbUrl ?? ''}" alt="" ${thumbUrl ? '' : 'hidden'} />` : ''}
      ${hasModel ? '' : `<span class="inv-mark" aria-hidden="true">${ITEM_MARK[item.type]}</span><span class="inv-item-name">${escape(item.name)}</span>`}${item.quantity && item.quantity > 1 ? `<span class="inv-quantity">${item.quantity}</span>` : ''}
    </button>`;
  }

  /** A key item on the Key Items page: a 2Ã—2-cell tile with its 3D model and its name. */
  private keyCard(item: InventoryItemView, index: number): string {
    const across = INVENTORY_GRID.columns / KEY_TILE;
    const x = (index % across) * KEY_TILE, y = Math.floor(index / across) * KEY_TILE;
    const thumbKey = item.model !== undefined ? ItemThumbnails.key(item.model, KEY_TILE, KEY_TILE, item.texture) : '';
    const thumbUrl = item.model !== undefined ? ItemThumbnails.get().getThumbnail(item.model, KEY_TILE, KEY_TILE, item.texture) : null;
    return `<button type="button" class="inv-item inv-key-item${item.model !== undefined ? ' inv-has-model' : ''}" data-slot="${item.slot}" style="grid-column:${x + 1} / span ${KEY_TILE};grid-row:${y + 1} / span ${KEY_TILE}" aria-label="${escape(item.name)}">
      ${item.model !== undefined ? `<img class="inv-item-thumb" data-thumb-key="${thumbKey}" src="${thumbUrl ?? ''}" alt="" ${thumbUrl ? '' : 'hidden'} />` : `<span class="inv-mark" aria-hidden="true">${ITEM_MARK[item.type]}</span>`}
      <span class="inv-item-name">${escape(item.name)}</span>
    </button>`;
  }

  /** A known spell on the Spells page: a 2×2 tile with the original's icon, its name and level. */
  private spellCard(spell: SpellId, level: number, index: number): string {
    const across = INVENTORY_GRID.columns / KEY_TILE;
    const x = (index % across) * KEY_TILE, y = Math.floor(index / across) * KEY_TILE;
    const url = spellIconUrl(spell, () => this.shown.inventory && this.page === 'spells' && this.render());
    const selected = this.spellStats?.spell === spell;
    return `<button type="button" class="inv-item inv-key-item inv-spell${selected ? ' inv-spell-selected' : ''}" data-spell="${spell}" style="grid-column:${x + 1} / span ${KEY_TILE};grid-row:${y + 1} / span ${KEY_TILE}" aria-label="${escape(SPELL_NAMES[spell])}">
      ${url ? `<img class="inv-item-thumb" src="${url}" alt="" draggable="false" />` : '<span class="inv-mark" aria-hidden="true">✦</span>'}
      <span class="inv-item-name">${escape(SPELL_NAMES[spell])} ${level}</span>
    </button>`;
  }

  private setPage(page: InventoryPage): void {
    if (page === this.page) return;
    this.page = page;
    this.hideTooltip();
    this.render();
  }

  private render(): void {
    if (this.drag) {
      this.renderPending = true;
      return;
    }
    this.renderPending = false;
    this.hideTooltip();
    const items = this.items();
    const rings = items.filter((i) => i.equipped && i.type === 'ring').sort((a, b) => a.slot - b.slot);
    const worn = (kind: EquipSlotKind) => kind === 'ring1' ? rings[0] : kind === 'ring2' ? rings[1] : items.find((i) => i.equipped && i.type === kind);
    this.equipment.innerHTML = EQUIP_SLOTS.map(({ kind, label, area }) => {
      const item = worn(kind);
      return `<div class="equip-slot${item ? ' occupied' : ''}" data-equip="${kind}" style="grid-area:${area}">${item ? this.itemCard(item) : `<span class="equip-label">${label}</span>`}</div>`;
    }).join('') + '<div class="equip-figure" aria-hidden="true"></div>';
    const bag = items.filter((i) => !i.equipped && !i.keyItem);
    const placed = layoutItemViews(items);
    this.grid.innerHTML = bag.flatMap((item) => {
      const p = placed.get(item.slot);
      return p ? [this.itemCard(item, p)] : [];
    }).join('');
    const keys = items.filter((i) => i.keyItem);
    this.keys.innerHTML = keys.map((item, i) => this.keyCard(item, i)).join('') || '<p class="inv-empty">No keys.</p>';
    this.root.querySelector('.inv-page-count')!.textContent = keys.length ? String(keys.length) : '';
    for (const tab of this.root.querySelectorAll<HTMLElement>('[data-page]')) tab.setAttribute('aria-selected', String(tab.dataset['page'] === this.page));
    const known = this.spellStats?.spells ?? [];
    this.spells.innerHTML = known.map((k, i) => this.spellCard(k.spell, k.level, i)).join('') || '<p class="inv-empty">No spells known.</p>';
    this.grid.hidden = this.page !== 'bag';
    this.keys.hidden = this.page !== 'keys';
    this.spells.hidden = this.page !== 'spells';
    const hidden = bag.length - placed.size;
    this.countValue.textContent = hidden > 0 ? `${hidden} item${hidden > 1 ? 's' : ''} do not fit` : '';
    this.countValue.classList.toggle('inv-warning', hidden > 0);
  }

  private renderGround(): void {
    this.groundList.innerHTML = this.ground.map((item) => {
      const named = modsTitle(item.name, item.mods);
      return `<button type="button" class="ground-item" data-object="${item.id}" aria-label="Pick up ${escape(named.title)}">
      <span class="inv-mark" aria-hidden="true">◆</span><span class="ground-name"><strong${named.color ? ` style="color:${named.color}"` : ''}>${escape(named.title)}</strong>${item.quantity > 1 ? ` ×${item.quantity}` : ''}<small>${item.distance.toFixed(1)} m</small></span>
    </button>`;
    }).join('') || '<p class="inv-empty">Nothing on the ground nearby.</p>';
  }

  /** A ground item's tooltip: its name in the rarity's colour, its affixes, the pick-up hint. */
  private groundTooltip(item: GroundItemView): string {
    const named = modsTitle(item.name, item.mods);
    const lines = [...affixLines(item.mods, { ranges: true }), ...(item.quantity > 1 ? [`Quantity: ${item.quantity}`] : [])];
    return `<strong class="tt-name"${named.color ? ` style="color:${named.color}"` : ''}>${escape(named.title)}</strong>
      ${itemLevelLine(item.mods)}${lines.map((l) => `<span>${escape(l)}</span>`).join('')}`;
  }

  // --- Tooltip

  private tooltipHtml(item: InventoryItemView): string {
    if (item.keyItem) {
      return `<strong class="tt-name tt-${item.type}">${escape(item.name)}</strong>
        <span>Opens a locked door</span>`;
    }
    // Path of Exile's order: the item's own numbers (scaled by rarity and refinement), a rule,
    // then each rolled affix with the range it rolls in.
    const own = withoutAffixes(item, item.mods);
    const scaled = !!item.mods?.rarity || !!item.mods?.plus;
    // Rarity and refinement scale damage and protection only (withMods): those show augmented.
    const implicit: { text: string; aug?: boolean; bonus?: string }[] = [];
    // What the affixes add to each own number, shown beside it ("Bash damage: 12 (+9)").
    const added = new Map<string, number>();
    for (const a of item.mods?.affixes ?? []) {
      const id = a.id === 'attr:intelligence' ? 'attr:intellect' : a.id;
      added.set(id, (added.get(id) ?? 0) + a.value);
    }
    const plus = (id: string, pct = false) => {
      const v = added.get(id);
      return v ? (pct ? `−${Math.round(v * 100)} %` : `+${Math.round(v * 100) / 100}`) : undefined;
    };
    own.damage?.forEach((v, i) => v > 0 && implicit.push({ aug: scaled, bonus: plus(`dmg:${DAMAGE_TYPES[i]}`), text: `${DAMAGE_TYPES[i]![0]}${DAMAGE_TYPES[i]!.slice(1).toLowerCase()} damage: ${v}` }));
    if (item.speed !== undefined && item.speed !== 1) implicit.push({ text: `Attack speed: ${item.speed}` });
    own.protection?.forEach((v, i) => v !== 1 && implicit.push({ aug: scaled, bonus: plus(`res:${DAMAGE_TYPES[i]}`, true), text: `${DAMAGE_TYPES[i]![0]}${DAMAGE_TYPES[i]!.slice(1).toLowerCase()} taken: ×${v}` }));
    for (const [k, v] of Object.entries(own.attributes ?? {})) if (v) implicit.push({ bonus: plus(`attr:${k}`), text: `${v > 0 ? '+' : ''}${v} ${ATTRIBUTE_LABEL[k] ?? k}` });
    if (item.heal) implicit.push({ text: `Restores ${item.heal} health` });
    const effects = item.effects ?? [];
    const affixes = affixLines(item.mods, { ranges: true });
    const lines: string[] = [];
    if (item.mods?.failstacks) lines.push(`Failed refinements: ${item.mods.failstacks}`);
    if (item.quantity && item.quantity > 1) lines.push(`Quantity: ${item.quantity}`);
    const refine = this.shop && this.refining && moddable({ type: item.type }) ? nextRefine(item.mods?.plus ?? 0) : undefined;
    if (refine) lines.push(`Refine to +${(item.mods?.plus ?? 0) + 1}: ${refine.gold.toLocaleString('en-US')} gold, ${refine.count} × ${BUILTIN_ITEMS.get(refine.material)?.name ?? refine.material}, ${Math.round(refineChance(item.mods?.plus ?? 0, item.mods?.failstacks ?? 0) * 100)} %`);
    if (this.shop) lines.push(item.value ? `Sells for ${item.value.toLocaleString('en-US')} gold` : 'The merchant will not take this');
    const named = modsTitle(item.name, item.mods);
    const sections = [
      [
        ...implicit.map((l) => `<span${l.aug ? ' class="tt-aug"' : ''}>${escape(l.text)}${l.bonus ? ` <span class="tt-affix">(${escape(l.bonus)})</span>` : ''}</span>`),
        ...effects.map((l) => `<span>${escape(l)}</span>`),
      ],
      affixes.map((l) => {
        const m = /^(.*?)( \(.*\))?$/.exec(l)!;
        return `<span class="tt-affix">${escape(m[1]!)}${m[2] ? `<span class="tt-range">${escape(m[2])}</span>` : ''}</span>`;
      }),
      lines.map((l) => `<span>${escape(l)}</span>`),
    ].filter((x, i) => x.length || (i === 0 && affixes.length)); // the rule above the affixes even with no own numbers
    return `<strong class="tt-name tt-${item.type}"${named.color ? ` style="color:${named.color}"` : ''}>${escape(named.title)}</strong>
      ${itemLevelLine(item.mods)}${sections.map((x) => x.join('')).join('<hr class="tt-sep" />')}`;
  }

  private hover(e: PointerEvent): void {
    if (this.drag || this.press) return;
    const spellEl = (e.target as HTMLElement).closest<HTMLElement>('[data-spell]');
    if (spellEl) {
      const spell = spellEl.dataset['spell'] as SpellId;
      const level = this.spellStats?.spells.find((k) => k.spell === spell)?.level ?? 1;
      this.tooltip.innerHTML = `<strong class="tt-name tt-spellbook">${escape(SPELL_NAMES[spell])}</strong>
        <span class="tt-type">Spell · level ${level}</span>
        <span>Mana: ${BUILTIN_SPELLS[spell]?.[level - 1]?.mana ?? 0}</span>
        <small>Click to select for casting · Drag to the hotbar</small>`;
      this.tooltip.hidden = false;
      const r = spellEl.getBoundingClientRect();
      const t = this.tooltip.getBoundingClientRect();
      const left = r.left - t.width - 8 >= 8 ? r.left - t.width - 8 : Math.min(innerWidth - t.width - 8, r.right + 8);
      this.tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, Math.min(innerHeight - t.height - 8, r.top)))}px)`;
      return;
    }
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-stock]');
    const stocked = row && this.shop?.stock[Number(row.dataset['stock'])];
    const groundEl = row ? null : (e.target as HTMLElement).closest<HTMLElement>('.ground-item');
    const onGround = groundEl && this.ground.find((g) => g.id === Number(groundEl.dataset['object']));
    const el = row ?? groundEl ?? (e.target as HTMLElement).closest<HTMLElement>('.inv-item');
    const item = stocked || onGround ? null : el && this.itemBySlot(Number(el.dataset['slot']));
    if (!el || (!item && !stocked && !onGround)) return;
    this.tooltip.innerHTML = stocked ? this.stockTooltip(stocked) : onGround ? this.groundTooltip(onGround) : this.tooltipHtml(item!);
    this.tooltip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = this.tooltip.getBoundingClientRect();
    // Beside the item, on the side with room; never off screen.
    const left = r.left - t.width - 8 >= 8 ? r.left - t.width - 8 : Math.min(innerWidth - t.width - 8, r.right + 8);
    const top = Math.max(8, Math.min(innerHeight - t.height - 8, r.top));
    this.tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private stockTooltip(item: ShopItemView): string {
    const lines: string[] = [];
    item.damage?.forEach((v, i) => v > 0 && lines.push(`${DAMAGE_TYPES[i]![0]}${DAMAGE_TYPES[i]!.slice(1).toLowerCase()} damage: ${v}`));
    if (item.speed !== undefined && item.speed !== 1) lines.push(`Attack speed: ${item.speed}`);
    item.protection?.forEach((v, i) => v !== 1 && lines.push(`${DAMAGE_TYPES[i]![0]}${DAMAGE_TYPES[i]!.slice(1).toLowerCase()} taken: ×${v}`));
    for (const [k, v] of Object.entries(item.attributes ?? {})) if (v) lines.push(`${v > 0 ? '+' : ''}${v} ${ATTRIBUTE_LABEL[k] ?? k}`);
    if (item.heal) lines.push(`Restores ${item.heal} health`);
    for (const e of item.effects ?? []) lines.push(e);
    lines.push(`Price: ${item.price.toLocaleString('en-US')} gold`);
    return `<strong class="tt-name tt-${item.type}">${escape(item.name)}</strong>
      ${lines.map((l) => `<span>${escape(l)}</span>`).join('')}`;
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

  /** Whether the item a full slot gives up (setEquipped: the first worn) would fit in the bag once `incoming` leaves it. */
  private swapFits(incoming: InventoryItemView): boolean {
    const worn = this.items().filter((i) => i.equipped && i.type === incoming.type && i.slot !== incoming.slot).sort((a, b) => a.slot - b.slot);
    const prev = worn.length >= equipCapacity(incoming.type) ? worn[0] : undefined;
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
    if (target.closest('[data-anvil]')) {
      this.onAnvil();
      return;
    }
    if (target.closest('[data-auction]')) {
      this.onAuction();
      return;
    }
    const close = target.closest<HTMLElement>('[data-close]');
    if (close) {
      if (close.dataset['close'] === 'shop') this.closeShop();
      else this.onToggle(close.dataset['close'] as InventoryPanelKind, false);
      return;
    }
    const stock = target.closest<HTMLElement>('[data-stock]');
    if (stock && this.shop) {
      const shop = this.shop;
      const index = Number(stock.dataset['stock']);
      const item = shop.stock[index];
      if (!item) return;
      if (item.price > this.gold) this.onNotice?.('Not enough gold.');
      else this.request(() => this.onBuy(shop.shop, index, item.itemId));
      return;
    }
    const page = target.closest<HTMLElement>('[data-page]');
    if (page) {
      this.setPage(page.dataset['page'] as InventoryPage);
      return;
    }
    if (target.closest('[data-toggle="ground"]')) {
      this.onToggle('ground', !this.shown.ground);
      return;
    }
    const spell = target.closest<HTMLElement>('[data-spell]');
    if (spell) {
      const press = this.spellPress;
      this.spellPress = null;
      if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) this.onSelectSpell(spell.dataset['spell'] as SpellId);
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
    // MMO items: Shift-click at a merchant refines it.
    if (e.shiftKey && this.shop && this.refining && moddable({ type: item.type })) {
      this.request(() => this.onRefine(item.slot, item.itemId));
      return;
    }
    if (item.type === 'potion') this.request(() => this.onUse(item.slot, item.itemId));
    else if (!isEquippable(item.type)) return;
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
    if (this.shop) {
      this.sell(item);
      return;
    }
    const quantity = item.quantity ?? 1;
    if (quantity >= 2) this.request(() => this.onSplit(item.slot, Math.floor(quantity / 2)));
  }

  private sell(item: InventoryItemView): void {
    const shop = this.shop;
    if (!shop) return;
    if (shop.gift) this.onNotice?.('Nothing is bought here.');
    else if (!item.value) this.onNotice?.('The merchant will not take that.');
    else this.request(() => this.onSell(shop.shop, item.slot, item.itemId));
  }

  // --- Drag and drop

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.drag) return;
    const spell = (e.target as HTMLElement).closest<HTMLElement>('[data-spell]');
    if (spell) {
      e.preventDefault();
      this.hideTooltip();
      this.spellPress = { x: e.clientX, y: e.clientY };
      this.onSpellDrag(spell.dataset['spell'] as SpellId, e);
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>('.inv-item');
    const item = el && this.itemBySlot(Number(el.dataset['slot']));
    if (!el || !item || item.keyItem) return; // key items stay on their page
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
    this.equipment.querySelectorAll(equipSelector(item.type)).forEach((el) => el.classList.add('equip-accepts'));
    this.hideTooltip();
    const cell = this.cellSize();
    // The grabbed point of the footprint, proportionally (an equipment slot is not footprint-sized).
    this.preview.show({ ...(item.model !== undefined ? { model: item.model } : {}), ...(item.texture ? { texture: item.texture } : {}), width, height, glyph: ITEM_MARK[item.type] },
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
    this.hotbar?.highlight(null);
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
    const hotbarSlot = HOTBAR_ITEM_TYPES.has(item.type) ? this.hotbar?.slotAt(x, y) ?? null : null;
    if (hotbarSlot !== null) return { kind: 'hotbar', slot: hotbarSlot };
    if (under?.closest('#hotbar')) return { kind: 'none' }; // between slots, or not a hotbar item: never dropped
    if (this.shop && under?.closest('.inv-shop')) return { kind: 'sell' };
    if (!under?.closest('.inv-main')) return { kind: 'drop' }; // the ground window, or anywhere outside
    const shape = shapeOf(item);
    if (under.closest('.inv-equipment')) {
      if (item.equipped || !isEquippable(item.type)) return { kind: 'none' };
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
    this.hotbar?.highlight(action.kind === 'hotbar' ? action.slot : null);
    const ground = this.root.querySelector('.inv-ground');
    ground?.classList.toggle('drop-hover', action.kind === 'drop' && this.shown.ground);
    this.shopWindow.classList.toggle('drop-hover', action.kind === 'sell');
    const equipping = action.kind === 'equip';
    this.equipment.querySelectorAll(equipSelector(drag.item.type)).forEach((slot) => {
      slot.classList.toggle('drop-hover', equipping && action.valid);
      slot.classList.toggle('drop-invalid', equipping && !action.valid);
    });
    this.grid.querySelectorAll('.inv-item.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
    const mergeInto = action.kind === 'merge' ? action.toSlot : action.kind === 'equip' && action.slot !== drag.item.slot ? action.slot : null;
    if (mergeInto !== null) this.grid.querySelector(`[data-slot="${mergeInto}"]`)?.classList.add('drop-hover');
  }

  private commit(item: InventoryItemView, action: DropAction): void {
    switch (action.kind) {
      case 'drop':
        this.request(() => this.onDrop(item.slot, item.itemId));
        return;
      case 'sell':
        this.sell(item);
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
      case 'hotbar':
        this.onHotbar(action.slot, item);
        return;
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
