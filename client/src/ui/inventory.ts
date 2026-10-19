import { DAMAGE_TYPES, type Inventory, type InventoryItemView } from '@crusaders/shared';

const SLOT_LABEL: Record<InventoryItemView['type'], string> = { weapon: 'Weapon', shield: 'Shield', armor: 'Armour', potion: 'Potion', spellbook: 'Spell book', key: 'Key', ring: 'Ring', amulet: 'Amulet', helm: 'Helm', gloves: 'Gloves', belt: 'Belt', boots: 'Boots' };

function describe(item: InventoryItemView): string {
  const parts: string[] = [];
  item.damage?.forEach((v, i) => v > 0 && parts.push(`${v} ${DAMAGE_TYPES[i]!.toLowerCase()}`));
  if (item.speed !== undefined && item.speed !== 1) parts.push(`speed ${item.speed}`);
  item.protection?.forEach((v, i) => v < 1 && parts.push(`${DAMAGE_TYPES[i]!.toLowerCase()} ×${v}`));
  if (item.heal) parts.push(`heals ${item.heal} — click to drink`);
  return parts.join(', ');
}

/** Inventory window (toggle with I): equipped items on top, bag below; click an item to (un)equip. */
export class InventoryPanel {
  private readonly root: HTMLElement;
  private inventory: Inventory | null = null;
  onToggleEquip: (slot: number, equip: boolean) => void = () => {};
  onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (el) this.onToggleEquip(Number(el.dataset['slot']), el.dataset['equipped'] !== 'true');
      else if ((e.target as HTMLElement).closest('[data-close]')) this.onClose();
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  set open(v: boolean) {
    this.root.hidden = !v;
    if (v) this.render();
  }

  update(inv: Inventory): void {
    this.inventory = inv;
    if (this.open) this.render();
  }

  private render(): void {
    const inv = this.inventory;
    const items = inv?.items ?? [];
    const equipped = items.filter((i) => i.equipped);
    const bag = items.filter((i) => !i.equipped);
    const row = (i: InventoryItemView) =>
      `<li data-slot="${i.slot}" data-equipped="${i.equipped}" title="${i.equipped ? 'Click to unequip' : 'Click to equip'}">` +
      `<span class="kind">${SLOT_LABEL[i.type]}</span><span class="name">${escape(i.name)}${i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ''}</span><span class="stats">${escape(describe(i))}</span></li>`;
    this.root.innerHTML = `
      <div class="head"><h2>Inventory</h2><button type="button" class="secondary" data-close>Close (I)</button></div>
      <h3>Equipped</h3>
      <ul>${equipped.map(row).join('') || '<li class="empty">Nothing equipped</li>'}</ul>
      <h3>Bag <span class="count">${items.length}/${inv?.slots ?? 0}</span></h3>
      <ul>${bag.map(row).join('') || '<li class="empty">Empty</li>'}</ul>`;
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
