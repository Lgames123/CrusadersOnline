Fix the map-transition (portal) bugs in the Citadel levels (ci*) and the levels connected to
them (cs*), without changing the login screen.

Read AGENTS.md, docs/context/INDEX.md and the notes it lists first (especially
2026-10-14-lighting-textures-movers-cutscenes.md and 2026-10-14-default-login-screen.md),
plus the skills in .agent/skills (inspect-level-data, decompile-crusaders,
commit-with-context-note).

## The problem (reported by the user)
Since the login/title screen was added, map transitions in the Citadel and its connected
maps are broken:
- Some map-change areas never fire: the player walks in and the map does not change.
- After entering the Citadel, going UP the stairs does not trigger the transition. It fires
  when going DOWN the stairs instead, which is wrong.
There may be more cases. Check every portal listed below, not only the stairs one.

## The portal network in scope (from local/generated/levels/*.placements.json)
- Citadel pairs: ci1a<->ci1b, ci2a<->ci2b, ci3a<->ci3b, ci4a<->ci4b, ci9a<->ci9b.
  The "a" map's trigger to "b" has a volume at yMin 872 / yMax 888 (level units). The "b"
  map's trigger back has a volume at about 844-856.
- Links to cs*: cs1a->ci1a, cs2a->ci2a, cs4a<->ci4a, ci1a->cs1a, ci2a->cs2a, ci3a->cs3a,
  ci9a->cs1a; cs1b also leads to cs1b-inn, ws1a, ca1a.
- Next-act exits: ci1b->ci2b, ci2b->ci9b, ci3b->ci4b, ci4b->ci3b, ci9b->ci1b.
- NO trigger volume (they fall back to the PORTAL_RADIUS/PORTAL_HEIGHT cylinder at the
  portal's y): cs1a->ci1a, cs2a->ci2a, ci1a->cs1a, ci2a->cs2a, ci3a->cs3a, and all ci*b
  next-act exits. Check whether the original has volumes for these that the converter drops
  (see the cap/portal record decoding), and whether the portal's y is right.
Re-dump this list yourself. Don't trust it blindly.

## Hard constraint
The login/title/character-screen backdrop (client/src/frontend/title_scene.ts, act ci1b,
added in commit 1493a2e) is approved as it is: same look, same camera shots, same cast.
If the fix needs it, the backdrop may use its own copy of the level (or part of it), so it
no longer shares state or data with the playable ci1b. The playable maps are what must change.

## Where to look (hypotheses: confirm, don't assume)
1. First check whether the login screen really caused this. Run the portal checks on a commit
   from before 1493a2e and on main. If the bug is older or unrelated, say so and fix the
   real cause anyway.
2. The title scene calls loadOriginalLevel('ci1b') in the browser. Look for state shared
   with the in-game load: module-level caches, singletons like dynamicLights, mutated
   ArenaDef/placements objects, objects reused after title.dispose()
   (client/src/main.ts ~202-233).
3. Portal logic: shared/src/arena/level.ts (LevelPortal, inPortal, cylinder fallback,
   trigger polygon + yMin/yMax, Z mirroring, the scale `s` in buildLevelArena ~line 441,
   arrival via floorNear/ringAround) and the server check in
   server/src/simulation/world_zone.ts. "Fires going down instead of up" points to a
   vertical mistake: the wrong trigger matched, a cylinder at the wrong y, yMin/yMax
   mis-scaled, or the arrival point landing inside a trigger that sends the player back.
4. Settle the behaviour from the decompiled code and the original Caps
   ("Crusaders of Might and Magic/Caps/*.cap", local/re/caps) first. Use runtime captures
   only for named gaps (decomp-first).

## Done means
- Every portal listed above fires where the original fires it (Citadel stairs up =
  transition), and nowhere else. Report a table: arena, target, trigger
  (volume/cylinder), verified yes/no, what was wrong.
- Arriving through a portal never drops the player inside a trigger that bounces them back.
- The login/server/character screens look and behave exactly as before (screenshot
  before/after).
- Add unit tests in tests/unit with the real trigger data for the cases you fixed (e.g.
  ci1a->ci1b: inside at the top of the stairs, outside at the bottom). The existing tests
  still pass.
- Verify in the running game: cs1a -> ci1a -> up the stairs to ci1b, plus at least one
  other previously broken transition.
- Commit with a context note (docs/context/YYYY-MM-DD-<slug>.md + INDEX.md line): root
  cause with evidence, which portals were wrong, anything still not decoded. Stage explicit
  files only (never git add -A). The working tree has uncommitted inventory work
  (world_zone.ts, level.ts, original_level.ts, ...). Don't commit or discard it; keep your
  changes separate.