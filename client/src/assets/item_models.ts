import { decalKind, itemSlug, type CharacterLook, type DecalKind } from '@crusaders/shared';

/**
 * What Drake's model wears for his equipped items. items.ctx gives each item a `Model` id
 * (rules/items.json); models.ctx binds the ids to files (the values below). Armour items are
 * inventory models whose texture names the body Drake wears: models.ctx's "Drake Armor models"
 * section binds those textures to Drake02armor.mdl (scale, banded, light plate, dragon scale)
 * and DrakeArmor05fixed.mdl (heavy plate), both on Drake's skeleton.
 */
const MODEL_FILES: Readonly<Record<number, string>> = {
  2: 'magicring', 4: 'ring', 8: 'longsword', 11: 'bottle01', 27: 'bottle02', 28: 'metalshield02',
  62: 'potion', 63: 'book1', 65: 'horn', 66: 'dashernecklace', 67: 'amuletoftruesight', 68: 'scepterofregency',
  69: 'manacrystal04', 71: 'standardaxe', 72: 'battleaxe', 73: 'standardmace', 74: 'heavymace',
  75: 'morningstar', 76: 'hammer', 77: 'broadsword03', 78: 'xucotal', 79: 'handbow001',
  80: 'drakearmor_i', 81: 'drakearmor2_i', 82: 'drakearmor3_i', 83: 'drakearmor4_i',
  84: 'icekey', 86: 'woodshield', 91: 'bookshelf01', 98: 'ironclub', 99: 'halberd', 116: 'bluntclub', 117: 'soulsucker',
  105: 'rune', 106: 'scroll', 110: 'stonekey', 118: 'magicring', 127: 'bolgahammer', 128: 'ceremswd', 129: 'cursedsword',
  130: 'cursedwaxe', 131: 'dfamshield', 132: 'durinhammer', 133: 'dwaxe', 134: 'famtreeswd', 135: 'pickaxe',
  137: 'book1', 138: 'book1', 139: 'book1', 140: 'book1', 141: 'potion',
  198: 'manacrystal02', 199: 'manacrystal03',
  243: 'bluntclub01lrg', 244: 'ironclub_big', 247: 'dragonarmor_icon',
};

/**
 * models.ctx `T` lines of the item models that have several: items.ctx `Texture` picks one by
 * index (0 = the first). Potions: Lesser Healing 0
 * blue, Greater Healing 1 dark green, Healing 2 green, Speed 3 grey; model 141 Mana 1 purple,
 * resistances 0-3 light blue / purple / red / white.
 */
const MODEL_TEXTURES: Readonly<Record<number, readonly string[]>> = {
  4: ['ringfire4', 'unholyfire', 'revelation'],
  8: ['longsword01', 'longsword01a'],
  28: ['shield128', 'reflshld', 'vampshld', 'iceshield'],
  62: ['potion-blue', 'potion-dkgr', 'potion-g', 'potion-grey'],
  63: ['lightbk64', 'firebk64', 'heroismbk64', 'souldbk64'],
  106: ['scrollmessdain', 'scrollmessscout', 'scrollmesswar'],
  137: ['slowbk64', 'spectralbk64', 'stonebk64', 'sparkbk64'],
  138: ['frzbk64', 'holywbk64', 'book64', 'dwtome64'],
  139: ['earthbk64', 'earthbk64-k', 'goodevilbk64', 'goodevilbk64-k'],
  140: ['spiritbk64', 'spiritbk64-k', 'revelbook64'],
  141: ['potion-ltbl', 'potion-purp', 'potion-red', 'potion-wht'],
};

/**
 * Texture key (manifest textures) to draw the item with, or undefined to keep the model's own.
 * Index 0 is applied too: a file bound to several ids (potion.mdl is 62 and 141, book1.mdl five
 * ids) is converted once with the first binding's texture.
 */
export function itemPreviewTexture(model: number | undefined, texture: number | undefined): string | undefined {
  return model === undefined ? undefined : MODEL_TEXTURES[model]?.[texture ?? 0];
}

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

type ItemRows = { name: string; fields: Record<string, string | number> }[];
let itemRows: Promise<ItemRows> | null = null;
let itemModels: Promise<Map<string, number>> | null = null;
let itemDecals: Promise<Map<string, DecalKind>> | null = null;

/** The converted items.ctx rows (empty without the game files). */
function loadItemRows(): Promise<ItemRows> {
  itemRows ??= fetch('/generated/rules/items.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ items: ItemRows }>) : { items: [] }))
    .then(({ items }) => items)
    .catch(() => []);
  return itemRows;
}

/** Item id -> items.ctx Model id, from the converted rules (empty without the game files). */
function loadItemModels(): Promise<Map<string, number>> {
  itemModels ??= loadItemRows().then((items) => new Map(items.filter((i) => typeof i.fields['Model'] === 'number').map((i) => [itemSlug(i.name), i.fields['Model'] as number])));
  return itemModels;
}

/** The mark a weapon leaves where it strikes a wall (items.ctx `Decal`), or null. */
export async function weaponDecal(itemId: string | undefined): Promise<DecalKind | null> {
  if (!itemId) return null;
  itemDecals ??= loadItemRows().then((items) => new Map(items.flatMap((i) => {
    const k = decalKind(i.fields['Decal']);
    return k ? [[itemSlug(i.name), k] as const] : [];
  })));
  return (await itemDecals).get(itemId) ?? null;
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

