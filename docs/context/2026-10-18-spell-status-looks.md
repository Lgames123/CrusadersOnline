# Spell status looks as the original

Date: 2026-10-18 · Agent: Claude Code · Commit: Stone skin, heroism and freeze look as the original; Torch Light is white

## Why
User: heroism ("Might"), stone skin and freeze showed a coloured capsule round Drake; Torch Light's look and sound seemed wrong.

## Decisions and evidence
- Decoded in executable-analysis §20.2 "Status looks" and "Torch Light's light". No status draws a body shell in the original: the capsules were stand-ins and are gone.
- Stone skin: the body blends into its stone texture (metatex INPUT1), up to 50 / 75 / 100 % by level, at +2 / +3 / +4 % a step, then ramps back down when it ends (`OriginalAvatar.setStoneSkin`). Only Drake has stone textures, so creatures that cast it look unchanged, as in the original.
- Heroism: HEROISM_EFFECT every 200 ms, 6 ft above the feet, variant = level.
- Effects.stg `SPHERE` shapes are now drawn as 18-polygon balls (the heroism sphere, soul drinker's target).
- Freeze only pauses the animation (as before) plus its SNAPFREEZE_TARGET. The thaw sound now plays at a random rate of 0.8–1.2.
- Torch Light's light is white (one value passed as r, g and b), not the warm orange used before.
- The torch wind-up and cast sound play when the cast starts. The original calls +0x24 from the input routine (0x0042BADE → 0x004BCF50), before the conjure, so the timing was already right. Sound ids match 0x004F654C (313 / 314 / 315 by level).

## Deviations from the original
- The metatex blend step rate is assumed to be 30 per second (the game's update rate), not measured.
- Statuses seen only as tags (entering view, PLAYER_STATS) count as level 1 for stone skin and heroism until a SPELL_EVENT gives the level.

## Not done / not decoded
- The torch light's position: +0xC4 × 4 ft. The vector is not identified (the client keeps 2 m up).
- Shape OUTER / INNER colours (only CENTER is used).
- Soul drinker's line.

## How to verify
- `spells-server` + `spells-client` (port 3101; the guest now also has heroism 3, stone skin 2 and freeze 1), Play as guest:
  - `__co.session.selectSpell('stoneskin'); __co.input.onAction('castSpell')`: Drake turns grey stone.
  - `'heroism'`: blue flares and a faint ball over him.
- `pnpm test:unit` (245 pass).
