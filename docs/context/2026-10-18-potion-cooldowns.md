# Potion cooldowns, drink and draw animations

Date: 2026-10-18 · Agent: Claude Code · Commit: Potions cool down, shown on the hotbar; drinking and gear swaps play Drake's clips

## Why
User asked for a cooldown per potion (Greater Healing 60 s, Healing 30 s, Mana Potion 30 s, Mana Crystals 10 s, resistance / speed potions until their effect ends), a white cover on the hotbar slot that drains with it, and the matching animation when a potion is drunk or a weapon swapped from the bar.

## Decisions and evidence
- Cooldowns are server-side (`potionCooldown` in items.ts, `Player.potionCooldowns` group → end tick): a use during one is refused and the inventory resent. Each potion its own group (by item id); Mana Crystals 1/2/3 share `mana_crystals`. Other HEAL potions (Lesser Healing = "Invisibility Potion" record, Extra / Generic) take 30 s.
- Boost potions: `ItemDef.duration` = items.ctx `UseParameters` first argument (30 s for Speed and the four resistances) and their cooldown is that duration.
- INVENTORY_UPDATE item views carry `cooldown` (s) and `cooldownLeft` (s, while running); the hotbar turns that into an end time (kept when a resend is within 300 ms, so the cover does not jump) and sizes `.hb-cd` per frame.
- Clips (Drake's models.ctx): PK12_u_ptn "use potion" is loaded (L line 162) but bound to no ASM state; used for potions. PJ01_u_ky "use crystal" (bound to ASM_GESTURE_MISC_04) for mana crystals. ASM_READY_WEAPON PP01 (30 frames, SWAP event 15) on a weapon equip, ASM_READY_SHIELD PT01 (38 frames, SWAP 16) on a shield equip. New ANIM ids 56-59, lengths in `ITEM_ACTION_SECONDS`.
- Played like a cast with no conjure (`LocalPlayer.startItemAction`): rooted while standing, upper body on the move; the server sets `p.anim` to it only while the player's anim is IDLE (rooted / standing), so others see it standing only. Applies to every drink (hotbar, H, Z, inventory) and every weapon / shield equip, not only the bar's.

## Deviations from the original
- Cooldowns and the drink animation are not original (always on); the original binds no clip to drinking.

## Not done / not decoded
- Boost potions still have no effect: `useItem` refuses anything without heal / mana, so their cooldown never starts yet. BOOST_PROTECTION / BOOST_ATTRIBUTE need decoding first.
- Cooldowns live in the zone: a zone change or relog resets them.
- The held model swaps at once, not on the clip's SWAP frame; PK12 is played with the weapon still in hand (no potion model).
- Armour equips play nothing; spells have no cooldown cover.

## How to verify
- `pnpm test:unit` (combat.test.ts: crystals refused for 10 s, drink anim). Launch `spells-server` (DEV_GUEST_ITEMS gives the guest potions, crystals, an axe and a metal shield) + `spells-client` (3101), play as guest, put them on the bar, press the keys.

## Follow-ups
- Implement the boost potions (resistances, speed) from the decomp.
