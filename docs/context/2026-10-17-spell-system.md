# The spell system: all eleven spells as the original

Date: 2026-10-17 · Agent: Claude Code · Commit: All eleven spells cast, fly, burst and linger as the original

## Why
User asked for the complete spell system (spells, sounds, animations, behaviours, how they are obtained and upgraded). Only Torch Light existed.

## Decisions and evidence
- Everything decoded from the exe; addresses and values in executable-analysis §20. Server: `server/src/simulation/spell_runtime.ts` (projectiles, explosions, ice storms, lightning chains, drains, statuses, ally) behind a `SpellHost`; data in `shared/src/game/spells.ts` (`SPELL_INFO`, `SPELL_RULES`, all S rows in `BUILTIN_SPELLS`).
- Self spells conjure, then play their own clip; fire ball / slow / lightning / soul drinker go at once (upper body while moving). Release on the clip's SPELL event, mana re-checked then. A hit aborts the cast (as before).
- Mana regen is now 5 s per point (0x004BCFC0); the old 3.9 s was one partial live sample.
- A book of a spell already at level 3 is used up anyway (0x004BCD10 caps silently); before, it stayed on the ground.
- Obtaining: books placed in ~30 levels (all eleven spells) plus the Cs2b hermit lady; nothing else grants spells in the original.
- Players and spectral allies form one side (`hostile()`); the mob brain now takes any `Actor` as its target.
- New SC.SPELL_EVENT (one message, optional parts) and ANIM.SPELL_CAST + spell index; ENTITY_SPAWN carries statuses / ally, PLAYER_STATS statuses.

## Deviations from the original
- Slow level 3 slows only creatures hostile to the caster (the original slows the whole world, caster x4): other players are not slowed.
- Looks not decoded are stand-ins: bolts as jagged lines, bursts as fading shells, statuses as a tinted shell (frozen ice, stone grey, heroism gold, slow violet).
- Spells aim with the view yaw / pitch of the latest input (the original uses the camera aim vector).

## Not done / not decoded
- Creature casters (Dark Mage, Necros, elementals, Deceiver...): their spell instances (0x004BD760) and the brain's choice to cast.
- Revelation's targets (class 0xCB objects) are unknown: it only shows its pulse.
- Lightning strike counts (1 / 2 / 4) read from the flag bits of 0x004BB9F0; bolt-to-bolt chaining (0x004BF380, 25 ft) folded into it.
- The thaw's ice shards (freezespell debris), heroism's loop sound 320, the hand node (approximated 4.3 ft up, 0.45 m ahead).

## Gotchas
- effects.stg *_PROJ flashes sustain 100 s and spawn trails: attach them (`Effects.attach`) and stop them with the projectile, never re-spawn them.
- Slowed creatures act on whole ticks (`timeAcc`) and `pauseMob` pushes every timer: add new mob timers there.
- Ally despawn is `removeMob`; its archetype's respawn is an hour so a dead ally never comes back.

## How to verify
- `pnpm test:unit` (spells.test.ts, spell_effects.test.ts).
- Launch configs `spells-server` + `spells-client` (port 3101): guests get `DEV_GUEST_SPELLS` / `DEV_GUEST_XP` (dev only) in the synthetic arena; drive with `__co.session.selectSpell(id)` and `__co.input.onAction('castSpell')`.

## Follow-ups
- Creature spellcasting; the spell icons / selection screen (0x00456B90); decode class 0xCB.
