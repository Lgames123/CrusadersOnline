Fix zone-transfer arrivals again. Commit 893071a ("Fix zone transfer arrival facing and
prevent portal bounce loops") did not solve it, and it added a regression.

Read AGENTS.md, docs/context/INDEX.md, 2026-10-14-citadel-portal-network-fixes.md and
2026-10-15-zone-transfer-arrival-and-facing.md (the previous attempt: read it critically,
parts of it are wrong). Skills: .agent/skills (decompile-crusaders, inspect-level-data,
commit-with-context-note). The user's capture localhost.har (repo root) holds the ci9a and
ci9b placements the client loaded. They match local/generated/levels.

## What the user still sees
1. Going ci9a -> ci9b, Drake appeared in a completely different, wrong place in ci9b.
2. On several maps Drake still appears "before" the trigger: on the wrong side of the
   return trigger. Walking forward takes him back through it.

## Root cause of (1): already found, verify it
arrivalNear() in shared/src/arena/level.ts takes the DESTINATION's return portal
(`back.exit`) and uses it as an index into the destination's `starts` table.
ci9a -> ci9b: the back portal in ci9b (target ci9a) has exit 2, so the code uses
ci9b.starts[2] = (2048, 817.5, -1456), heading 288. The stairs the player came up are at
about (2048..2068, ~845, -1336..-1354): over 100 ft away and 30 ft lower. The "exit ==
start index" mapping is a guess, and the data contradicts it:
- exit numbers are often larger than the starts table: 98, 103, 104/105, 108/109,
  112/113, 40;
- they come in pairs between connected maps (ci9a exit 1 <-> ci9b exit 2,
  ci3b 113 <-> ci4b 112, co1a 105 <-> co8a 104, cs1b 40 <-> ws1a 40);
- ca*b -> ca*a lands in a level with ONE start, yet its exit is 1 or 2.
Starts look like new-game / act starts and dummies (e.g. y 384, heading 28 in several
levels), not per-door entrances. Remove the starts-by-exit path unless the decompiled
code proves the mapping. To prove it, find where DAT_0058d0ce is WRITTEN (the code that
runs on crossing a portal), not just where 0x476F20 reads it. Then show a table of
source exit -> destination start chosen, with the actual coordinates. Each one must sit
next to the matching return portal. No proof: don't use starts for transfers.

## What "before" and "after" the trigger mean (precise definition)
The return trigger is the volume in the destination map that leads back to the map just
left. Walking into it is how a player would go back.
- AFTER (correct) = on the side of that trigger that is connected, by walkable floor, to
  the rest of the destination level (its other portals, its creatures, starts[0]),
  without passing through any trigger.
- BEFORE (wrong) = inside the trigger, or in the pocket behind it (the dead-end corridor
  or stair end the trigger closes off), or any position from which the rest of the level
  is reachable only by walking through the trigger.
Decide it by connectivity on the collision mesh, not by "outward normal of a polygon
edge". Flood-fill walkable triangles from the candidate point (steps up to the player's
step height, triggers treated as walls) and check that the region reaches the level's
other portals/content. The pocket behind a trigger is small and reaches nothing.
Facing: point away from the return trigger, along the walkable path into that region
(for example the direction of the first metres of the flood-fill / shortest path into
the level). Never face the trigger.

## Use continuity where the maps share coordinates
Many paired maps share one world frame. Their portals sit within about 15 ft of each
other: all ci*a <-> ci*b (14 ft), cm*a <-> cm*b (16 ft), and the 0 ft pairs ci3b<->ci4b,
co1a<->co8a, co3a<->co9a. Confirm per pair by comparing meshes and trigger positions. For
these, carry the player's real state across: the position where he crossed the source
trigger and his actual heading (same yaw: same frame). Then advance him along that
heading until he is AFTER the return trigger (definition above), on floor. That is the
continuity the user asked for: holding W keeps going the same way. For pairs in different
frames (ca*, cs* <-> ci*, ws*, du*, ...), use the connectivity rule.
The transfer must carry the crossing position and heading. Today join() only gets
`arrivingFrom` (server/src/simulation/world_zone.ts ~683, server/src/zone/*); add them
to the transfer.

## Don't trust a self-made sweep alone
The last note says "0 failures out of 157", and the user still hits failures. The check
used the same assumptions as the code. This time:
- Write the connectivity check independently of the arrival code, and run it over every
  portal pair in local/generated/levels.
- Generate a top-down image per arrival (SVG or PNG, under local/ or the scratchpad, not
  committed): walkable floor near the trigger, both triggers, the arrival point, the
  facing arrow, and the source crossing point for shared-frame pairs. Review ci9a<->ci9b,
  ci1a<->ci1b, cs1a<->ci1a, ci3b<->ci4b, ca1a<->ca1b and cs1b<->cs1b-inn yourself, and
  list the image paths so the user can look too.
- Only if the code and data still leave the original's behaviour open: capture where the
  original game places the player on one transition with Frida (see the memory/notes on
  the Python runner). Named gap only. Captures never overrule the decompiled code.

## Done means
- ci9a -> ci9b and back, holding W: lands right after the stairs trigger, keeps walking the
  same way, no bounce, no teleport elsewhere.
- Every pair passes the independent connectivity + forward-walk check. Report the before and
  after counts, and the images for the cases above.
- Client and server agree on the arrival position and yaw (no camera snap back).
- Tests in tests/unit/portals.test.ts cover: the ci9b starts[2] regression, a shared-frame
  pair (continuity), a different-frame pair (connectivity), and a pocket-behind-trigger
  case. Existing tests pass.
- Verify in the running game with the user's flow: ci9a <-> ci9b, plus cs1a -> ci1a and
  ci3b -> ci4b.
- Login/title screen untouched.
- Commit with a context note that says "Supersedes: 2026-10-15-zone-transfer-arrival-and-
  facing.md". Record what DAT_0058d0ce really holds (or that it is still undecoded), why
  starts-by-exit was removed, which pairs share a frame, and how to verify. Stage explicit
  files only (never git add -A; prompt*.md and localhost.har stay out of the commit).
