# Boost potions take effect

Date: 2026-10-18 · Agent: Claude Code · Commit: Speed and resistance potions take effect: timed statuses from the decompiled BOOST_ATTRIBUTE / BOOST_PROTECTION

## Why
The Speed Potion and the four resistance potions were refused by `useItem`. Their effects had never been decoded (follow-up from 2026-10-18-potion-cooldowns.md).

## Decisions and evidence
- Decoded in executable-analysis §20 ("Boost potions"). Use factory 0x004022B0. BOOST_PROTECTION use 0x00401D10: status kind 6 (resist ×, the +0x17C stone skin uses) with the type's entry = args[2]. So **0.25 is a multiplier** (a quarter taken). Its tag is −2, which the add 0x0047E550 never replaces, so different resistances stack. BOOST_ATTRIBUTE use 0x00401AB0: kind 9-12 (MIGHT/INTELLIGENCE/ENDURANCE/SPEED), +ftol(args[2]) to the bonus +0xD4..+0xE0. Duration = args[0] s.
- The player's per-frame status tick (0x0044DC30) re-runs Stats_ComputeDerived 0x0044E090, which runs the effective attributes 0x0044E000 (capped at 50). So +25 Speed changes the speed multiplier at once and until the status ends. The server's `refreshDerived` does the same on every status change (and on level-up). PLAYER_STATS `attributes` are now the effective ones.
- `ItemDef.boost` = `{ kind: 'protection', type, multiplier } | { kind: 'attribute', attribute, amount }`, read in `catalogFromItemRules`. Statuses go through `SpellRuntime.setStatus`: protection → `incoming` vector (tags RFIR/RAIR/REAR/RWAT, one per type, standing in for tag −2), attribute → `attributes` (BMIG/BINT/BEND/BSPD).
- `SpellRuntime.incoming` now multiplies **every** status's `incoming` (stone skin × potions), not only STON's. The resist getter 0x0044CB60 includes +0x17C, so `SpellHost.resist` (what freeze reads) and the PLAYER_STATS resist column include these statuses now. That covers stone skin too, a small change for it: Water Resistance (0.25) makes the drinker freeze-immune, as in the original.
- Sound 0x19E (414) is sent on a boost drink as an SC.SPELL_EVENT sound.

## Deviations from the original
- The original stacks two potions of the same resistance (tag −2). Here one tag per type replaces it, but the potion cooldown (= duration) already prevents a second one while it runs.

## Not done / not decoded
- Flag 0x8000000 that both uses set on the controller (+0x48 vtable +0x2C) is not decoded and is not reproduced.
- Healing / mana potions still play no sound (only the boost uses were read).
- The permanent `Equip` forms (duration ≤ 0, e.g. Fist of Necros LIGHT 0.5) are not applied. Only potions read `boost`.
- The client has no shell look (STATUS_LOOK) for the new tags. The HUD lists them by STATUS_NAMES.

## How to verify
- `pnpm test:unit`: combat.test.ts "boost potions" (25 % fire for 30 s, two resistances at once, Speed +25 → speed multiplier and back, cap 50).

## Follow-ups
- Apply BOOST_PROTECTION / BOOST_ATTRIBUTE `Equip` forms on worn items (Fist of Necros).
