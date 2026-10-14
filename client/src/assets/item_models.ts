import { itemSlug, type CharacterLook } from '@crusaders/shared';

/**
 * What Drake's model wears for his equipped items. items.ctx gives each item a `Model` id
 * (rules/items.json); models.ctx binds the ids to files (the values below). Armour items are
 * inventory models whose texture names the body Drake wears: models.ctx's "Drake Armor models"
 * section binds those textures to Drake02armor.mdl (scale, banded, light plate, dragon scale)
 * and DrakeArmor05fixed.mdl (heavy plate), both on Drake's skeleton.
 */
const MODEL_FILES: Readonly<Record<number, string>> = {
  2: 'magicring', 4: 'ring', 8: 'longsword', 11: 'bottle01', 27: 'bottle02', 28: 'metalshield02',
  62: 'potion', 63: 'book1', 71: 'standardaxe', 72: 'battleaxe', 73: 'standardmace', 74: 'heavymace',
  75: 'morningstar', 76: 'hammer', 77: 'broadsword03', 78: 'xucotal', 79: 'handbow001',
  80: 'drakearmor_i', 81: 'drakearmor2_i', 82: 'drakearmor3_i', 83: 'drakearmor4_i',
  86: 'woodshield', 91: 'bookshelf01', 98: 'ironclub', 99: 'halberd', 116: 'bluntclub', 117: 'soulsucker',
  118: 'magicring', 127: 'bolgahammer', 128: 'ceremswd', 129: 'cursedsword',
  130: 'cursedwaxe', 131: 'dfamshield', 132: 'durinhammer', 133: 'dwaxe', 134: 'famtreeswd', 135: 'pickaxe',
  137: 'book1', 138: 'book1', 139: 'book1', 140: 'book1', 141: 'potion',
  243: 'bluntclub01lrg', 244: 'ironclub_big', 247: 'dragonarmor_icon',
};

/** File-key for a handheld inventory preview, or undefined when the item has no standalone mesh. */
export function itemPreviewModelFile(model: number | undefined): string | undefined {
  return model === undefined ? undefined : MODEL_FILES[model];
}

/** Armour item model id -> Drake's body model and its texture (models.ctx 80-83, 247 / 121, 124). */
const ARMOR_BODIES: Readonly<Record<number, { model: string; texture: string }>> = {
  80: { model: 'drake02armor', texture: 'drake02armor2' },
  81: { model: 'drake02armor', texture: 'drake02armor3' },
  82: { model: 'drake02armor', texture: 'drake02armor4' },
  83: { model: 'drakearmor05fixed', texture: 'drake05armor5' },
  247: { model: 'drake02armor', texture: 'drake02armor5' },
};

/** Model files Drake is drawn with: weapon (right hand), shield (left forearm), armour body. */
export interface DrakeOutfit {
  right?: string;
  left?: string;
  body?: { model: string; texture: string };
}

let itemModels: Promise<Map<string, number>> | null = null;

/** Item id -> items.ctx Model id, from the converted rules (empty without the game files). */
function loadItemModels(): Promise<Map<string, number>> {
  itemModels ??= fetch('/generated/rules/items.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ items: { name: string; fields: Record<string, string | number> }[] }>) : { items: [] }))
    .then(({ items }) => new Map(items.filter((i) => typeof i.fields['Model'] === 'number').map((i) => [itemSlug(i.name), i.fields['Model'] as number])))
    .catch(() => new Map());
  return itemModels;
}

/** The models for a character's equipped items. */
export async function outfitFor(look: CharacterLook): Promise<DrakeOutfit> {
  const models = await loadItemModels();
  const id = (item: string | undefined) => (item ? models.get(item) : undefined);
  const right = MODEL_FILES[id(look.weapon) ?? -1];
  const left = MODEL_FILES[id(look.shield) ?? -1];
  const body = ARMOR_BODIES[id(look.armor) ?? -1];
  return { ...(right ? { right } : {}), ...(left ? { left } : {}), ...(body ? { body } : {}) };
}

/** Derives a CharacterLook from a list of inventory items. */
export function lookFromInventory(items: readonly { itemId: string; type: string; equipped: boolean }[]): CharacterLook {
  const look: CharacterLook = {};
  for (const item of items) {
    if (!item.equipped) continue;
    if (item.type === 'weapon' || item.type === 'shield' || item.type === 'armor') {
      look[item.type as 'weapon' | 'shield' | 'armor'] = item.itemId;
    }
  }
  return look;
}

