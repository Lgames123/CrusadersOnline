Fix where Drake appears, and which way he faces, after a map transition (zone transfer),
so he always lands past the trigger and facing away from it. Bad case: ci9a <-> ci9b.
The problem affects every map transition, not just this pair.

Read AGENTS.md, docs/context/INDEX.md and the notes it lists first, especially
2026-10-14-citadel-portal-network-fixes.md (the previous portal fix: trigger volumes,
spiral-stair arrivals, MANIFEST_VERSION gotcha). Read the skills in .agent/skills
(inspect-level-data, decompile-crusaders, commit-with-context-note).

## The problem (reported by the user)
- Going from ci9a to ci9b, Drake appears on the wrong side of the return trigger (before
  it). A few more steps forward put him back in the trigger, and he loops between the maps.
- No continuity of facing: walking with W held, after the map changes he sometimes faces
  back toward the trigger, so holding W sends him straight back to the previous map. This
  happens on other maps too.

## What the code does now (verify)
- Position: arrivalPoint() in shared/src/arena/level.ts finds the destination's portal
  whose target is the map we came from, then floorNear()/ringAround() picks the first
  floor about 0.8 m outside that trigger in ANY direction. Nothing makes it the side facing
  into the level, so it can land behind or beside the trigger. Example: ci9b's trigger back
  to ci9a is a thin strip (polygon x 2056..2068, z -1350..-1354, y 841..856), so the
  arrival point can sit on the far side.
- Facing: WorldZone.join() in server/src/simulation/world_zone.ts (~line 709) keeps
  opts.yaw from the previous zone; only arena.starts sets a facing. The client may also
  keep its own camera/view yaw across the transfer. Check client/src/main.ts and the
  client session for that.

## What to find out first (decomp-first)
- How the original places the player on a level change. Portals carry an `exit` number
  (ci9a: exit 1 -> ci9b; ci9b: exit 2 -> ci9a, exit 103 -> ci1b), and levels have start
  points (arena.starts, used at 0x476F20 for a new game). Check in the decompiled code and
  the Cap files whether the original spawns at a start/entrance record matched by the
  exit number, with its own position and yaw. If it does, use that data: it is the
  faithful fix and gives facing for free. Record addresses and offsets in the note.
- Only where the original has no such record, fall back to geometry (next section).

## Fallback rule when the data has no entrance point
- Position: on walkable floor, outside the return trigger with a clear margin (more than
  one or two steps). The side must face the level interior, not behind or beside the
  trigger. Derive "interior" from the trigger edge with floor continuing beyond it, or
  from the direction away from the dead end. Keep the multi-floor/stair rules from the
  previous note (floor closest to the trigger's height).
- Facing: away from the return trigger, toward the interior along the same direction.
  Never toward the trigger.
- Holding W after arrival must never put the player back in the return trigger within
  the first few metres.

## Done means
- ci9a -> ci9b and ci9b -> ci9a: no loop, Drake lands past the trigger, faces into the map.
- Sweep EVERY portal pair in local/generated/levels/*.placements.json with a script or
  unit test. For each arrival, assert: the point is not inside any trigger; walking 3-5 m
  forward along the spawn yaw (on the collision mesh) does not enter the return trigger.
  Report a table of failures before and after.
- Server and client agree on the spawn yaw: no snap back to the old view direction on the
  client after the transfer.
- Unit tests in tests/unit (extend tests/unit/portals.test.ts); the existing tests still
  pass. If placements change, bump MANIFEST_VERSION in converter/src/pipeline.ts and
  re-run pnpm convert.
- Verify in the running game: ci9a <-> ci9b both ways holding W, plus two other pairs
  (e.g. cs1a -> ci1a, ci1a -> ci1b).
- Don't touch the login/title screen (client/src/frontend/title_scene.ts).
- Commit with a context note (docs/context/YYYY-MM-DD-<slug>.md + INDEX.md line,
  "Supersedes" the arrival parts of 2026-10-14-citadel-portal-network-fixes.md if
  replaced): how the original picks the entrance (with evidence), where you used the
  fallback, anything still not decoded. Stage explicit files only (never git add -A).