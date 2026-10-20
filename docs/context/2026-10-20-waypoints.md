# Waypoint crystals: fast travel after the story

Date: 2026-10-20 · Agent: Claude Code · Commit: Waypoint crystals take a finished character to any act of the campaign

## Why
User request (CMP-002): once Necros is dead, a teleport crystal in every map lets the player go
back anywhere. The use key opens a map to pick the destination. Places that recur through the
story (Cador Sul in several acts) are split by act. The art for the crystal came from the user
(`client/public/waypoint-crystal.webp`).

## Decisions and evidence
- **One crystal per act**, 81 acts in all.
  - The training level has none: it is not part of the campaign.
  - The four inns have none: they are one door away from Cador Sul, and three of them have no
    flat floor that is clear of their triggers.
- **Chapters** (`WAYPOINT_CHAPTERS`, the map's "Act I–V" tabs). Each act's chapter comes from the
  main-quest triggers it holds (quest indices → strings 3100–3109) and from the exit graph:
  - Act I: Ws9a (the escape) through Ci1b (Celestia).
  - Act II: Co1a / Cm2b / Co2a / Du2a / Co3a (the Horn).
  - Act III: Ci3b → Gl1b (Ursan).
  - Act IV: Du1c / Gl3c / Du3c / Co4a (the Solidify spell, King Dain).
  - Act V: Es4a / Ws5a / Bs1a / Cs5b (Necros).
  - The act number in an act's name is not the chapter (Ca1 is reached from Cs2b). The town acts
    (cs / ci / ws) do follow their digit.
- **Crystal spot** (`waypointSpot`, shared, deterministic):
  - The search starts at the act's respawn point (start 0 or its first entry) and tries rings of
    2.5–20 m, beginning straight ahead of the start heading.
  - A spot needs a flat floor with 2.6 m of head room and a level 0.8 m pad.
  - It must keep 1.2 m clear of every exit, story / message / shop / sound trigger, prop hull,
    brush, object and creature placement. Story volumes are checked at 0.9 m height plus a
    1.2 m ring, so arriving never starts a sequence.
  - The arrival point is 1.8 m from the crystal and faces it. Facing away put the chase camera
    inside the crystal.
- **Server**:
  - The zone computes the spot once and sends it in SC_WORLD_ENTER (`waypoint`).
  - CS_WAYPOINT_TRAVEL (0x17) `{act}` is checked against: `completedAt` set, the player within
    3 m of the crystal, alive, not in a sequence / ending / held, the target a campaign act and
    not the current one.
  - The portal event carries `waypoint`, the session joins the target with `arrivingWaypoint`,
    and the join places the player at the arrival point.
  - The respawn spot stays the act's own beginning.
- **Client**: the crystal is drawn only when `storyComplete` is set. It is built from primitives
  (`engine/waypoint_crystal.ts`) with a dynamic light, and the Tab prompt reads "waypoint
  crystal". The map (`ui/waypoint_map.ts`) injects its own CSS, so `index.html` is untouched.

## Deviations from the original
- All of it: the original has no fast travel. It is always on, but only for characters who
  finished the story. Others never see a crystal.

## Not done / not decoded
- The crystal is not solid: you can walk through it.
- No cooldown. Every trip is a zone transfer, which is its own limit.
- The completion reward (CMP-008) is still open, by the user's decision.
- The map is schematic: regions placed by the story's geography, not the original's map art.

## Gotchas
- `DEV_GUEST_FINISHED=1` (not in production) gives guests a finished story, to see the crystals.
- If the converter changes an act's triggers or props, its crystal moves. tests/unit/waypoints.test
  checks every converted act still has a spot.
- Driving `__co.frame` by hand during a zone swap can hit a freed physics world (ClassicCamera
  ray). That only happens when frames are driven by hand.

## How to verify
- `pnpm test:unit waypoints`: chapters, labels, a spot in every act, arrival and server checks
  on cs2b.
- Live: run a server with `ARENA=level:cs2b DATABASE_URL=pglite:memory DEV_GUEST_FINISHED=1`
  and play as guest. The crystal stands ahead of the start. Tab opens the map; Act IV →
  Glaciers → part 3 lands in Gl3c beside its crystal. Checked live: cs2b → gl3c → ci3b.

## Follow-ups
- A real map image per region, if the user wants one.
- Whether waypoints should also unlock earlier (per region visited) as a server feature.
