# Refined weapons shed star dust (after Rappelz's galaxy stones)

Date: 2026-10-20 · Agent: Claude Code · Commit: Refined weapons shed galaxy star dust, stronger with each refinement

## Why
The user asked for particles on upgraded weapons, growing with refinement, like Rappelz's galaxy stone effect.

## Decisions and evidence
- `WeaponSparkles` (weapon_sparkles.ts): one `THREE.Points` in the scene, own ShaderMaterial (procedural four-point star with a white core; soft disc for nebula motes), additive, no texture.
- Spawns on 256 area-weighted surface samples of the held 'WPN RIGHT' model, weighted toward the far end of its longest bounding-box axis (the grip is the held model's origin, as weapon_glow.ts notes).
- Stars are world space from spawn, swirling one way round the weapon's axis while drifting out: a swing leaves a spiral trail.
- k = (plus − 2) / 8: rate 4 + 60k² per second (≈5 at +3, 64 at +10), size, drift, swirl speed and brightness scale with k. Palettes follow the glow's tiers (+3 silver, +5 cyan, +7 violet/blue/pink, +9 gold, +10 cycling hues); nebula motes from +7.
- Same switch and slider as the glow (`itemGlow` / `itemGlowIntensity`): no separate setting.

## Deviations from the original
- Not original (MMO items); off with the Refined Gear Glow option.

## Not done / not decoded
- Local player only, like the glow (other players' item mods are not replicated). Shields and armour get no particles.
- Not seen on the real character models in game; checked in an isolated three.js scene with a box sword at +3/+5/+7/+9/+10 (still and swinging).

## Gotchas
- Point size is in world metres: the `scale` uniform is set in `onBeforeRender` from the drawing buffer height and the camera's projection.
- Surface samples are taken once per held model; a weapon swap re-samples (it compares the held object).

## How to verify
- Server with `GAME_FEATURES=mmoItems`, refine a sword to +3 or more (Shift-click at a shop); stars appear on the blade and thicken per level.
