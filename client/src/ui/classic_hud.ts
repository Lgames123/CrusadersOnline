import { SPELLS, type PlayerStats, type SpellId } from '@crusaders/shared';

/**
 * The original's HUD (init 0x468430, layout 0x468800, gauges 0x468F90, draw 0x4697E0), on its
 * 640 × 480 screen scaled to the window's height and pinned to the top left corner:
 * - Health coin at (10, 10), 76.8 square: HUDwheel turned counter-clockwise by
 *   (1 − hp / max) × 211°, HUDcover over it under 40 %, HUDbody, then HUDHealthCoin (Drake's
 *   face, blending into the skull as health falls: metatex FACTOR0 = 100 − hp %), the hit points
 *   ("%d") centred 14 above its bottom.
 * - The selected spell at (16.4, 87.44), 64 square: its HUDSpell icon in (10, 9)-(55, 54) and
 *   HUDSLRing1-3 for its level.
 * - Mana coin at (10, 152.08): the same pieces turned half a turn (HUDwheelM / HUDcoverM, the
 *   body's plate on top), the spell school's stone upright on it (spells 0-5 HUDstElem, 6-8
 *   HUDstSpirit, 9-10 HUDstGE), the mana 2 below its top.
 * The quick-use item slot (when an item is selected, everything below moves down 64.64) is not
 * here: the game has no selected item; the hotbar holds them.
 */
const SIZE = 76.8;
const SPELL_SIZE = 64;
const HEALTH = { x: 10, y: 10 };
const SPELL = { x: 16.4, y: 87.44 };
const MANA = { x: 10, y: 152.08 };
/** Wheel turn from full to empty, degrees (0x468F90: (1 − f) × 211 × π/180). */
const WHEEL_TURN = 211;
/** Below this fraction the cover arc hides the wheel's far end (0x468F90, 0.4). */
const COVER_BELOW = 0.4;

/** Spell icon textures (metatex HUD<Name> → Sp<Name>.tga), by the original's spell order. */
const SPELL_TEXTURE: Readonly<Record<SpellId, string>> = {
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

function schoolStone(spell: SpellId | null | undefined): string {
  const i = spell ? SPELLS.indexOf(spell) : -1;
  return i > 8 ? 'hudstge' : i > 5 ? 'hudstspirit' : 'hudstelem';
}

export class ClassicHud {
  private readonly root: HTMLElement;
  private readonly url: (t: string) => string;
  private readonly hpWheel: HTMLImageElement;
  private readonly hpCover: HTMLImageElement;
  private readonly skull: HTMLImageElement;
  private readonly hpText: HTMLElement;
  private readonly spellBox: HTMLElement;
  private readonly spellIcon: HTMLImageElement;
  private readonly spellRing: HTMLImageElement;
  private readonly manaWheel: HTMLImageElement;
  private readonly manaCover: HTMLImageElement;
  private readonly stone: HTMLImageElement;
  private readonly manaText: HTMLElement;

  constructor(root: HTMLElement, textures: Record<string, string>) {
    this.root = root;
    this.url = (t) => (textures[t] ? `/generated/${textures[t]}` : '');
    const piece = (parent: HTMLElement, t: string, cls = '') => {
      const img = document.createElement('img');
      img.className = `ch-piece ${cls}`.trim();
      img.alt = '';
      img.draggable = false;
      if (t) img.src = this.url(t);
      parent.append(img);
      return img;
    };
    const group = (at: { x: number; y: number }, size: number, cls: string) => {
      const g = document.createElement('div');
      g.className = `ch-group ${cls}`;
      Object.assign(g.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${size}px`, height: `${size}px` });
      root.append(g);
      return g;
    };
    const text = (parent: HTMLElement, top: number) => {
      const t = document.createElement('div');
      t.className = 'ch-number';
      t.style.top = `${top}px`;
      parent.append(t);
      return t;
    };

    const hp = group(HEALTH, SIZE, 'ch-health');
    this.hpWheel = piece(hp, 'hudwheel');
    this.hpCover = piece(hp, 'hudcover');
    piece(hp, 'hudbody');
    piece(hp, 'huddrake');
    this.skull = piece(hp, 'hudskull');
    this.hpText = text(hp, SIZE - 14);

    this.spellBox = group(SPELL, SPELL_SIZE, 'ch-spell');
    this.spellIcon = piece(this.spellBox, '', 'ch-spell-icon');
    this.spellRing = piece(this.spellBox, 'hudslring1');

    const mana = group(MANA, SIZE, 'ch-mana');
    this.manaWheel = piece(mana, 'hudwheelm');
    this.manaCover = piece(mana, 'hudcoverm', 'ch-flip');
    piece(mana, 'hudbody', 'ch-flip');
    this.stone = piece(mana, 'hudstelem');
    this.manaText = text(mana, 2);

    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  /** The 640 × 480 screen at the window's height. */
  private fit(): void {
    this.root.style.transform = `scale(${window.innerHeight / 480})`;
  }

  update(s: PlayerStats): void {
    const hpFrac = s.maxHp > 0 ? Math.min(1, Math.max(0, s.hp / s.maxHp)) : 0;
    this.hpWheel.style.transform = `rotate(${-(1 - hpFrac) * WHEEL_TURN}deg)`;
    this.hpCover.hidden = hpFrac >= COVER_BELOW;
    this.skull.style.opacity = String(1 - hpFrac);
    this.hpText.textContent = String(Math.max(0, Math.round(s.hp)));

    // Mana: the wheel's quad is built with negated corners (a half turn), then turned the same way.
    const manaFrac = s.maxMana > 0 ? Math.min(1, Math.max(0, s.mana / s.maxMana)) : 0;
    this.manaWheel.style.transform = `rotate(${180 - (1 - manaFrac) * WHEEL_TURN}deg)`;
    this.manaCover.hidden = manaFrac >= COVER_BELOW;
    this.manaText.textContent = String(Math.max(0, Math.round(s.mana)));
    const stone = this.url(schoolStone(s.spell));
    if (this.stone.getAttribute('src') !== stone) this.stone.src = stone;

    const level = s.spell ? s.spells.find((k) => k.spell === s.spell)?.level ?? 1 : 0;
    this.spellBox.hidden = !s.spell;
    if (s.spell) {
      const icon = this.url(SPELL_TEXTURE[s.spell]);
      if (this.spellIcon.getAttribute('src') !== icon) this.spellIcon.src = icon;
      const ring = this.url(`hudslring${Math.min(3, Math.max(1, level))}`);
      if (this.spellRing.getAttribute('src') !== ring) this.spellRing.src = ring;
    }
  }
}
