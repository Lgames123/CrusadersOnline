# Creature casters

Date: 2026-10-17 · Agent: Claude Code · Commit: Dark Mages, Dark Masters and Skeleton Ghosts cast their spells as the original

## Why
The spell system left creature casters out; the original's casters throw fire balls, lightning, soul drinker and unholy wrath at the player.

## Decisions and evidence
- Decoded in executable-analysis §20.1: masks from the template table, the creatures' own spell instances (0x630A50) and their per-cast values (0x004BD7C0), the decide branches (0x004096A0) and the spell phase (0x0040AA20 / 0x00408840), cooldowns (0x0040EBE0) and the 2 s stand after (0x0040EC70).
- Spawnable casters (LEVEL_ARCHETYPES): Dark Mage (soul drinker 8-20 ft on a 30 % roll, fire ball beyond 8 ft), Dark Master (unholy wrath / fire ball), Skeleton Ghost (lightning), Deceiver (homing fire ball). Weak on purpose: FIRE 3, AIR 3, soul drinker 3, unholy wrath DARK 30 in 20 ft.
- A ranged caster beyond 8 ft with a clear line stands its ground: it waits out the cooldown facing the target instead of running in (the phase only ends within 8 ft or on a hit).
- The Deceiver's fire ball plays ASM_THROW_ITEM (0x00428220 group fallback); that clip has no SPELL event, so nothing is thrown. Faithful to the code and data; it means the Deceiver stands and gestures at range.
- Players are creature type 142 for the spell type tests (was 0x96 = Necros, which made Drake immune to unholy wrath and soul-drinker-proof).
- Effects go through `SpellRuntime.release(..., { target })`: lightning strikes the target itself (sound 522), fire balls carry FIREBALL_PROJ_EVIL (new optional `projectile.look`) with sound 316, unholy wrath shows UNHOLY_WRATH_CAST and a dark burst (`burst.dark`).

## Not done / not decoded
- Necros: his difficulty-scaled values, Force Globe (bit 8, class 15) and bit 9; brain kind 5 (0x0040B540). Necros is no level archetype.
- The template-6 swing when no spell is castable (only soul drinker against a spectral ally); the creature just decides again.
- Creature wind-up effects / sounds at cast start (vtable +0x24 for creatures not traced): only the release's effects and sounds play.
- Not checked in the browser; no live capture of a caster.

## Gotchas
- New mob timers (`spellReadyAt`, `mobCast`) are pushed in `pauseMob`; hits (`hitReaction`), `calmDown` and death clear the cast.
- A creature's `attacking()` includes its cast (state flag 0x20).

## How to verify
- `pnpm test:unit` (creature_spells.test.ts).
- In game: a Skeleton Ghost noticed from 30 ft casts PK05 and bolts the player every ~6 s.

## Follow-ups
- Live capture of a Deceiver at range to confirm the empty throw; Necros's fight.
