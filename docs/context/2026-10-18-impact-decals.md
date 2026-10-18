# Weapon and spell marks on walls (the original's decals)

Date: 2026-10-18 · Agent: Claude Code · Commit: Weapons and spells leave the original's marks on walls: chop, slam, scratch, scorch, lightning, frost

## Why
User: hitting walls should look different by weapon (hammers / maces one way, slashing weapons another) and by spell (lightning, fire ball).

## Decisions and evidence
- Full write-up: `docs/reverse-engineering/executable-analysis.md` §8.6c. The difference is a **decal**, not the sparks: the blade-on-wall routine 0x0048CAB0 always throws SWORD_DAMAGE + SWORD_METAL ×3, then stamps the held weapon's items.ctx `Decal` (CHOP axes 2 ft, SLAM maces / hammers / clubs 2.5 ft, SCRATCH swords 2 ft) along the blade's motion.
- Spells: fire ball impact SCORCH (on a creature too: the floor round it), lightning LIGHTNING only when the bolt meets the level, snap freeze FROST under each character the ice storm catches and where a missed bolt meets the level. Sent as `decals` in SC.SPELL_EVENT.
- Placement as 0x00443580: faces in front of the point with size² − d² ≥ 0.2 ft², square clipped to each face, 0.07 ft off it; 5 s full then 1.5 s fade; a new decal ends those within twice its size; 50 at most. Faces = LevelLight's triangles (`forEachNear`), lit per vertex by the face's own lightmap texel (the original sums the cell's lights).
- Wall hit sound decoded too: 338 + round(rand × 4) at the striker (was silent).
- textures.nfo's material `Decal` (hole / slash / scorch) is dead data: nothing but the items parser reads decal names. So the wall's material changes nothing.

## Deviations from the original
- Clipped to our level triangles, not to the original's cell polygons (same marks; a decal can also reach faces of a neighbouring cell).
- Lit by the lightmap instead of the cell's dynamic light sum (dynamic lights do not light decals).

## Not done / not decoded
- Wall hits are still the local player's own probe (ray at 1.2 m ahead at the impact frame), not a blade-segment test; other players' and creatures' blows on walls show nothing.
- BLOODSTAIN (bleeding / dying, 0x0044C6A0 / 0x0044DD50 / 0x004577F0), footprints (0x00457890 on FOOTSTEP events), CLAW (no item uses it) and 0x004C0BD0's SCORCH (an unidentified projectile class) are not stamped.

## Gotchas
- Decals stamped close together end each other at once (original rule): to compare kinds side by side, space them more than 2 × size apart.
- A decal needs the point *in front* of a face (CCW normal): stamping from behind a wall puts nothing on it.

## How to verify
- `tests/unit/spell_effects.test.ts`: fire ball → one SCORCH, lightning on a creature → none, freeze → FROST at the skeleton.
- `?level=ca1a`, Play offline, swing at the wall ahead (start spot, 1.3 m forward): the long sword's scratch on the wall. Dev: `__co.decals.stamp('SLAM', pos, dir)`.

## Follow-ups
- Remote players' and creatures' blows on walls (server-side contact test, sent with the swing).
- Bloodstains and footprints.
