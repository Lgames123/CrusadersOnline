# The waypoint map draws the original's world map

Date: 2026-10-20 · Agent: Claude Code · Commit: Waypoint map uses the original world map; regions outside the chapter are not marked

## Why
User request: use the game's own map as the waypoint screen's background, and do not show
areas a chapter cannot reach (no Necros's Battleship in Act I).

## Decisions and evidence
- **Tiles**: 0x4549F0 draws four 256² textures at the floats in 0x4EF360: (64, 47.5), (319, 47.5),
  (64, 302.5), (319, 302.5), i.e. 255 px apart. map3 / map4 hold only their top 128 rows, so the
  map is 511×383 (`WAYPOINT_MAP_SIZE`). The SVG viewBox is that size; tiles come from
  `/generated/manifest.json` (the player's own conversion, nothing hosted).
- **map1 vs map1a**: 0x454920 / 0x454AD0 load map1a (the map with the battleship drawn) only when
  the map's destination index is 8; the waypoint map uses map1a only in a chapter that has a
  `bs` act (Act V).
- **Region markers**: `WAYPOINT_REGIONS` x/y/w/h are now the label scrolls on that art (centre and
  size in map pixels, measured by eye). Only the chapter's regions get a lit, clickable box; the
  rest have nothing. The art carries its own labels and roads, so the SVG text and
  `WAYPOINT_ROADS` are gone.
- The original's marker positions (0x4547C0 → 0x589A04, 10 places in the order Citadel, Cador Sul,
  W/E Stronghold, Duskwood, Catacombs, Glaciers, Corantha, Mines, Battleship) are offsets of the
  "you are here" sprite, not the labels; not used.

## Not done / not decoded
- The original's road overlays (road-2 … road-14, table 0x4EF380) are not drawn.
- Labels of regions outside the chapter stay visible on the art itself (only map1a/map1 removes
  one: the ship).

## How to verify
- Seen in the client without a server: `await import('/src/ui/waypoint_map.ts')`,
  `new WaypointMap().show('cs2b')`; Act I lights Citadel / Cador Sul / W. Stronghold with no ship,
  Act V draws and lights the battleship.
