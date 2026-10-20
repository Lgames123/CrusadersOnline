# Door prompts, loading text and the party frame name areas, not act codes

Date: 2026-10-20 · Agent: Claude Code · Commit: Door prompts and loading text show friendly area names

## Why
"Tab — go to CS1B-INN" showed the raw act code; the user asked for friendly names.

## Decisions and evidence
- `areaName` (waypoints.ts): the region's name from `WAYPOINT_REGIONS` ("The Catacombs"); `<act>-inn` → "Cador Sul Inn"; a dungeon instance (`@…`) its base act's region; `train` → "Training Grounds"; anything unknown upper-cased as before.
- The inns are Cs1b/Cs2b/Cs4b, off Cador Sul (the user's example said "Citadel Inn"). The string table names no inn, so they are "Cador Sul Inn".
- Used by the door prompt, "Entering …" and the party frame's member location. The waypoint map keeps its own `waypointLabel` ("— part n").

## Deviations from the original
- Not original. The original's door exits have no prompt.

## Gotchas
- Acts of one region now read the same ("The Catacombs" for ca1a–ca3d): no part number in the prompt.

## How to verify
- `pnpm test:unit waypoints`. In game, stand at the inn door in Cs1b: "Tab — go to Cador Sul Inn". Not seen live.
