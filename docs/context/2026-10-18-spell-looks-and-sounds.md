# Spell looks and sounds closer to the original

Date: 2026-10-18 · Agent: Claude Code · Commit: Spells show the original bolt, rings and hand wind-ups; sounds carry and pitch as the original

## Why
User: the spells' visual effects and sounds were not the original ones.

## Decisions and evidence
- Decoded in executable-analysis §20.2.
- The Sound.ctx ids were already right (table 0x004F654C). What differed was how they play. Spell sounds now carry to their priority's distance (A 200 ft … D 60 ft, table 0x004F61D8) instead of the client's flat 35 m. The bolt (522) and explosion (528) sounds play at a random rate of 0.8–1.2 (`sounds[].rate`).
- Wind-ups hang on the caster's attachment dummies and follow them: Drake index 0 = WPN LEFT, 1 = WPN RIGHT (`SPELL_INFO.windupNodes`, `Avatar.attachPoint`). Before, they showed at a fixed point above the feet.
- Lightning bolt: a camera-facing strip textured with `lightning`, with `lightningcap` sprites at both ends. It goes through the 7-point jittered profile of 0x004BFBB0 (15 nodes) and fades over 0.75 s. This replaces the jagged lines.
- Holy wrath / unholy wrath / revelation: `ring.mdl` (ringfire4 / unholyfire / revelation) at the caster's feet, scaled (r, min(r,10), r). This replaces the coloured spheres.
- Removed invented looks: the glow cores on fire ball and slow projectiles (their carried effect is the look) and the shells on explosions and slow bursts (those objects have no model).
- An effect level without its own variant now steps down to the nearest lower level (0x00482150). Before, it fell back to level 1.
- Torch Light's LIGHT_CAST shows 6 ft above the feet (0x004BADE0), not at the hand.

## Deviations from the original
- Ring spin `+0x28(r × 30)` is read as degrees about the vertical. Bolt width 40 is read as effect size units (2 ft). Both are inferred, not measured.
- The bolt is always the single 7-point strip. The chained form with two branches (0x004BFA90) is not drawn.
- Sound volume falloff is still the client's own curve; only the cut-off distance follows the priority.

## Not done / not decoded
- Status looks are still stand-in shells: frozen (flag 4 + model +0x54), stone skin texture variants 6/8/10, heroism, slow.
- Soul drinker's line and snap freeze's flying glow are still stand-ins (component 0x004C1000 not decoded).
- The bolt's per-frame LIGHTNING_TARGET spawn and light while it lives (0x004BF0F0) are not reproduced; the server sends one per strike.
- Force Globe (model5 / eglobe) is not drawn, because Necros is not spawned.
- Drake's spell taunts DK_SPL_01..08 (Sound.ctx 945–952) have no reference in the code. Treated as unused.

## Gotchas
- `ring.glb` geometry is cached and shared: `dispose()` on a timed ring frees its GPU buffers, and three.js re-uploads them on the next ring. Do not mutate the geometry.
- Revelation's ring lives only 0.1 s, so a screenshot rarely catches it. Clone it on `scene.add` to inspect.

## How to verify
- Launch `spells-server` + `spells-client` (port 3101), Play as guest. Run `__co.session.selectSpell('lightning'); __co.input.onAction('castSpell')`: the wind-up shows on the sword hand and a textured bolt reaches the skeleton. With `'revelation'`, a blue fire ring appears at the feet.
- `pnpm test:unit` (245 pass). One full `pnpm test` run reported 260/261 passing. The failing test was not identified; the rerun was stopped. It is probably the integration test that hangs while the dev server holds the DB (see the torch-fire note).

## Follow-ups
- Decode the status looks (frozen model, stone skin variants) and component 0x004C1000 (snap freeze, soul drinker).
- Draw the chained bolt with branches.
