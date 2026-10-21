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
  75: 'morningstar', 76: 'hammer', 77: 'broadsword03', 78: 'xucotal', 79: 'handbow001', 97: 'arrow01',
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
  71: ['standardaxe', 'boomeraxe64'],
  76: ['warhammer64', 'hammershatter'],
  // Blade of the Burning Heart and of the Silent Chill wear the plain blade (models.ctx 77).
  77: ['broad', 'broad', 'shadowblade', 'broad'],
  99: ['halberd64', 'flamestinger'],
  244: ['ironclub64', 'rodofnecros'],
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

/**
 * Drake's armour bodies, items.ctx `SetArmorSkin(model, texture)`: models.ctx 121 Drake02armor.mdl
 * (scale, banded, light plate, dragon scale) and 124 DrakeArmor05fixed.mdl (heavy plate; Plate of
 * Sanctuary and of Elemental Protection inherit it from Heavy Plate Mail).
 */
const ARMOR_SKINS: Readonly<Record<number, { model: string; textures: readonly string[] }>> = {
  121: { model: 'drake02armor', textures: ['drake02armor2', 'drake02armor3', 'drake02armor4', 'drake02armor5'] },
  124: { model: 'drakearmor05fixed', textures: ['drake05armor5'] },
};

/**
 * Models files Drake is drawn with: weapon (right hand), shield (left forearm), armour body. A held
 * item's file may end in `#<texture>`: the model drawn with that texture variant (Shadow Blade...).
 */
export interface DrakeOutfit {
  right?: string;
  left?: string;
  body?: { model: string; texture: string };
}

type ItemRow = { name: string; parent?: string | null; fields: Record<string, string | number>; calls?: { name: string; args: (string | number)[] }[] };
type ItemLook = { model?: number; texture: number; skin?: { model: number; texture: number } };
let itemRows: Promise<ItemRow[]> | null = null;
let itemLooks: Promise<Map<string, ItemLook>> | null = null;
let itemDecals: Promise<Map<string, DecalKind>> | null = null;

/** The converted items.ctx rows (empty without the game files). */
function loadItemRows(): Promise<ItemRow[]> {
  itemRows ??= fetch('/generated/rules/items.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ items: ItemRow[] }>) : { items: [] }))
    .then(({ items }) => items)
    .catch(() => []);
  return itemRows;
}

/** Item id -> items.ctx Model, Texture and armour skin (inherited from the parents), from the converted rules. */
function loadItemLooks(): Promise<Map<string, ItemLook>> {
  itemLooks ??= loadItemRows().then((items) => {
    const byName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
    const skinOf = (row: ItemRow | undefined, depth = 0): ItemLook['skin'] => {
      if (!row || depth > 32) return undefined;
      const args = row.calls?.find((c) => c.name === 'SetArmorSkin')?.args;
      if (args) return { model: Number(args[0]), texture: Number(args[1] ?? 0) || 0 };
      return skinOf(row.parent ? byName.get(row.parent.toLowerCase()) : undefined, depth + 1);
    };
    return new Map(items.map((i) => {
      const model = typeof i.fields['Model'] === 'number' ? i.fields['Model'] : undefined;
      const skin = i.fields['Type'] === 'ARMOR' ? skinOf(i) : undefined;
      return [itemSlug(i.name), { ...(model !== undefined ? { model } : {}), texture: Number(i.fields['Texture'] ?? 0) || 0, ...(skin ? { skin } : {}) }];
    }));
  });
  return itemLooks;
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

/** A held item's file key, with `#<texture>` when its items.ctx Texture picks another variant. */
function heldFile(look: ItemLook | undefined): string | undefined {
  const file = look?.model !== undefined ? MODEL_FILES[look.model] : undefined;
  if (!file) return undefined;
  const variants = MODEL_TEXTURES[look!.model!];
  const tex = variants && look!.texture > 0 ? variants[look!.texture] : undefined;
  return tex && tex !== variants![0] ? `${file}#${tex}` : file;
}

/** The models for a character's equipped items. */
export async function outfitFor(look: CharacterLook): Promise<DrakeOutfit> {
  const looks = await loadItemLooks();
  const of = (item: string | undefined) => (item ? looks.get(item) : undefined);
  const right = heldFile(of(look.weapon));
  const left = heldFile(of(look.shield));
  const skin = of(look.armor)?.skin;
  const skinDef = skin ? ARMOR_SKINS[skin.model] : undefined;
  const skinTexture = skinDef?.textures[skin!.texture] ?? skinDef?.textures[0];
  const body = skinDef && skinTexture ? { model: skinDef.model, texture: skinTexture } : undefined;
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

