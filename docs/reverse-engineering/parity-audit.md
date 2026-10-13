# Parity Audit: the Port Against the Original (2026-10-13)

A pass over everything ported so far, system by system, against the evidence we have: the
executable (static reading, now with the gaps filled, local/PASSADA_REA_GAPS.md), live captures
(x32dbg, Frida) and the game's data files. Goal: the original's behaviour by default.

Behaviours that differ from the original are not deleted: they are kept, switched off, for a
possible return as features:

- **Gameplay** (server rules): `shared/src/game/features.ts`, off by default, switched on per
  server with `GAME_FEATURES=name,name`; the client learns them from SC_WORLD_ENTER.
- **Presentation** (per player): the client settings, off by default and marked "not original".

Status: **original** (matches the evidence), **fixed** (changed in this pass), **kept as feature**,
**MMO** (deliberate change for a persistent multiplayer world), **unverified** (no evidence yet;
the current value is a stand-in until a capture or a reading settles it).

## 1. Changed in this pass

| System | Before | Original (evidence) | Now |
|---|---|---|---|
| Side swings (A/D + click) | each played its whole clip (balance request) | re-triggered mid-swing 0.3 s into the previous one, alternating sides (Frida, executable-analysis §14.1b) | **fixed**; old behaviour = feature `sideSwingFullClip` |
| Reactive creature block | option on the zone only | skeletons raise the shield only in their stance, never in reaction (§15.2) | already off; now feature `reactiveBlock` |
| Character shadows | silhouettes on by default | a shadow texture projected on the floor polygons (shadow routine 0x4ACA10, triage in local/PLANO_GEMINIREA.md); the round shadow is the closest we have | **fixed**: round shadow by default; silhouettes = setting (not original) |
| Hit effects | sizes in tenths of a foot × 0.425 by eye, MOVE / GRAVITY per 30 Hz tick, no chips from creatures | from the code: 0.05 ft per size unit, MOVE ft/s, GRAVITY ft/s² turned by the flash heading, rotation in turns/s; a landed blow also throws 5 physical chips in the victim's texture (executable-analysis §8.6) | **fixed** (units and the chips); half size stays a setting `smallEffects` (not original) |

## 2. Checked: matches the evidence

| System | Evidence |
|---|---|
| Movement speeds, jump, gravity, air control, turn rates | root motion of Drake's clips, x32dbg (§11, §13) |
| Classic camera rig and smoothing | executable (§10) |
| Attack keys, five-step combo, wall jab, air swing | combo routine 0x0042CA20, Frida (§14.1b) |
| Clip rate and swing timing (SWING / IMPACT / RECOVERY events) | §14 |
| Damage, resists, armour, block cone, HP formula, XP curve | executable (§8, §9) |
| Hit reactions (impact / stun / knock-down rule) | HP-loss routine, live (§15.2) |
| Shield up: walk, retreat, side hops; shield rush | Frida (§14.2, §14.1b) |
| Skeleton combat AI (distance bands, hop, chains, stance, shield, jab, retreat, bash, leap) | four Frida logs (§15.2) |
| Citizens under assault, talking (turn, gesture) | Frida (§16) |
| Swinging doors (mover keys, delay, sounds), levers | `.cap` mover records, Frida |
| Breaking props (chips, pieces, impact sound) | Frida (§16); piece size and life (5-10 s, 1.5 s small) from 0x4108B0 |
| Sword trail (line, nodes, alpha ramp, texture) | decompiled trail pool (§16) |
| Creature HP, XP, resists, loadouts | `.cap` placements, creature template table |
| Projectile / effect object pool sizes (32 debris, 8 arrows, ...) | 0x482F60 (local/PASSADA_REA_GAPS.md §7) |

## 3. MMO (kept on purpose)

Server authority and prediction, persistence instead of save shrines, threat shared between
players, mob and object respawns (10 s / 5 min), player respawn after death (5 s), leash (80 m;
the original's skeletons followed past 75 m), zone workers.

## 4. Unverified (stand-ins in use; to settle with captures or the executable)

| System | Stand-in | How to settle |
|---|---|---|
| Creature perception (aggro) | 10 m radius, same floor (±3 m) | the AI maneuver tables (0x004EA268) and their reader; capture: approach an idle skeleton and log the distance at its first RUNNING request, behind a wall and in the open |
| AI of the other creatures (dwarves, ogres, dashers, knights, casters, elementals) | the skeleton's | Frida AI log per creature type |
| Creature drops | gold 5-10, loot table (long sword 25 %, scale armour 10 %) | capture: kill creatures and note what falls |
| Interaction reach (Tab pick-up / open / talk) | 2.5 m (doors 1.8 m from the slab) | the object search 0x437A70 is a segment test: log its segment length |
| Portal fallback cylinder | radius / height for portals without a volume | most portals carry their volume (decoded); rare |
| Lightmap gain | texture × lightmap × 2 (by eye, approved by the user) | the D3D driver (gfx_d3d.dll) only sets MODULATE (×1) and DESTCOLOR × ZERO blending: the ×2 must come from how the lightmap texels are uploaded; find that conversion |
| Starting equipment | Axe + Wooden Shield | the first act's start |
| Locked doors | a hand-made list (train door, inn rooms); key in the potion slot + Z, as in the original | the acts' door scripting (sequence scripts) |
| NPC lines | each NPC cycles its voice role's lines | the acts' sequence scripts (HermitLadySeq13 ...) |
| Citizens' strolls | 4 m around their place, pauses 4-12 s | wander capture covered only a few citizens |
| How long frightened citizens stay wary | 60 s | capture ended first |
| Spells other than Torch Light | not implemented | captures per spell |
| Script interpreter argument evaluator (0x415300) | not decompiled | local/PASSADA_REA_GAPS.md §7 |
