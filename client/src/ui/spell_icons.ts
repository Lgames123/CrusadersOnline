import type { SpellId } from '@crusaders/shared';
import { ItemThumbnails } from './item_thumbnails.ts';

/**
 * The original's spell icons (the HUD spell wheel): metatex.ctx HUDSpell<Name> -> BASE
 * HUD<Name> -> `*Image=HUD<Name> FILE=Sp<Name>.tga`, 64×64 round icons in a bronze ring.
 * Keys are the converted textures' manifest names.
 */
const SPELL_ICON_TEXTURE: Readonly<Record<SpellId, string>> = {
  torch_light: 'splight',
  fireball: 'spfireball',
  slow: 'spslow',
  freeze: 'spfreeze',
  stoneskin: 'spstone',
  lightning: 'splightning',
  heroism: 'spheroism',
  spectral_ally: 'spally',
  revelation: 'sprevelation',
  holy_wrath: 'spwrath',
  soul_drinker: 'spdrink',
};

const resolved = new Map<SpellId, string | null>();
const pending = new Map<SpellId, Promise<string | null>>();

/** The spell's icon URL once known (null while loading or when not converted); `onReady` fires once it is. */
export function spellIconUrl(spell: SpellId, onReady?: (url: string) => void): string | null {
  if (resolved.has(spell)) return resolved.get(spell) ?? null;
  let p = pending.get(spell);
  if (!p) {
    p = ItemThumbnails.get().textureUrl(SPELL_ICON_TEXTURE[spell]).then((url) => {
      resolved.set(spell, url);
      return url;
    });
    pending.set(spell, p);
  }
  if (onReady) void p.then((url) => url && onReady(url));
  return null;
}
