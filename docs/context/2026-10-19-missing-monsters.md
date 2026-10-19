# Missing monsters: elementals, Necros, Ghost Father; unarmed damage and scale

Date: 2026-10-19 · Agent: Claude Code · Commit: Elementals, Necros and the Ghost Father fight as the original; creatures add their unarmed damage and wear their scale

## Why
Hostile placements of five creature types were dropped at load: Rock Elementals (the Catacombs' and
mines' "stone golems", 31), Ice Elementals (Glacier, 37), Lava Elementals (7), Necros (bs1a) and the
Ghost Father (Cs4b inn). Full pass over every act: these are all the fightable ones missing.

## Decisions and evidence
- Decoded in executable-analysis §22. Placement record: unarmed damage at XP block −0x1A8, scale at
  −0x1D4 (converter 1.30). Unarmed damage now adds to every creature's weapon (0x0044CCF0), so the
  existing fights hit harder too: skeletons +2 DARK, Shadows +15 DARK, Dark Masters +10 DARK, Titans +10 WATER.
- Blows are swept by the model's own DMY LINEs from a SWING-prefixed event to an event named exactly
  RECOVERY (0x004575A0 prefix dispatch, 0x00482E90 exact match). Elementals: high punch frames
  25–32 at 11.5 ft; low punch three sweeps from 10 / 19 / 28 ("SWING RECOVERY" is a SWING event) at
  8.1 / 11.8 / 12.8 ft, one hit each; jab falls back to CHOP_LOW; leap and ram never hit. Reaches
  measured by forward kinematics of the lines, × placement scale.
- Elementals' "fire ball" throw is `icewalk` (8.26 ft root motion): each empty throw walks them in,
  2 s stand, again, until melee within 8 ft. Without this they stood at range forever.
- Elementals move by their own clips (run 18 ft / 20 frames), not the humanoid rig's.
- Necros: steadfast (no impacts), every blow knocks the player down, rams a raised shield, his
  difficulty-scaled spells, Force Globe = status GLOB for 10 s (spell immunity except holy wrath;
  blows land), re-raised whenever down. 0.2 s stand after casts.
- Scale: model size, attack reach, and > 1.5 never hops / +3 to the attack roll (0x004083F0).

## Deviations from the original
- Necros waits hidden (not sent, not thinking, not hittable) until a player's seqNecros finishes,
  and hides again when he respawns (300 s): the world is shared, the original starts the sequence
  on load. His cutscene's Appear 1 reveals him for everyone.
- Elementals' hop and leap use the humanoid timed-action root motion (their clips go 16 / 30 ft).
- Globe size, turn and blink rate approximate (original sizes it by the owner's bounding radius).

## Not done / not decoded
- What happens when Necros dies (no death trigger in bs1a's story; the ending is not wired).
- Necros's unholy wrath "duration 4000 ms" is passed but the ring ignores durations.
- Cutscene-only hostiles (XP −10: co4a CDwarf3, du1c/du3c Dasher Scout*Seq) stay unspawned, as before.
- Character capsule not scaled (a 9 ft elemental collides like Drake). Scale does not change speed.

## Gotchas
- `again` sweeps clear the swing's hit set, breakables included.
- `Mob.hidden` is checked in `hostile()`, the mob update loop, snapshots and cutscene actor mapping;
  anything new that picks targets must go through `hostile()`.
- IceElemental.mdl's vertices are bone-local: client head height now uses the skinned box.

## How to verify
- `pnpm test:unit` (missing_monsters.test.ts). In game: ca1b, the Rock Elemental in the alcove at
  (2680, 1012, −1908): it walks in on its throws and punches for 19 (medium).
- Test pair in `.claude/launch.json`: monsters-server (8192, ca1b, guest spawned in front of it) + monsters-client (3102).

## Follow-ups
- The ending after Necros's death; scaled capsules for big creatures.
