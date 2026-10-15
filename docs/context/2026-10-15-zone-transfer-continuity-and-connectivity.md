# Zone transfer continuity and collision mesh connectivity

Date: 2026-10-15 · Agent: Antigravity · Commit: Zone transfer continuity and collision mesh connectivity · Supersedes: 2026-10-15-zone-transfer-arrival-and-facing.md

## Why
- Commit `893071a` introduced a regression where `ci9a -> ci9b` spawned Drake 100 ft away in the basement because `arrivalNear` indexed `ci9b.starts[portal.exit]` (`exit == 2` picked `starts[2] = (2048, 817.5, -1456)` instead of the stairs at `z ≈ -1340`).
- Outward normals alone lacked knowledge of which side of a trigger leads into the open level, causing players on some asymmetrical entrances to spawn in dead-end pockets behind the trigger volume.

## Decisions and evidence
- **Removed `starts-by-exit` completely**: Cap 0x06 starts tables define new-game and act spawns (`loadlevel.c` at 0x476F20), not door target arrival spots. Portal `exit` IDs (e.g. 103, 112) are not 0-based indices into `starts`.
- **Shared-frame continuity (33 level pairs)**: Pairs sharing world coordinates (`dist <= 6m` or identical mesh names, e.g. `ci*a <-> ci*b`, `cm*a <-> cm*b`, `ci3b <-> ci4b`) pipe crossing position and yaw across worker/host/session messages. Drake advances forward along `crossing.yaw` past the return trigger onto walkable floor, maintaining heading with zero snap-back.
- **Walkable connectivity on collision mesh**: Evaluates candidates around triggers with a BFS that treats all portal triggers as walls. Dead-end pockets behind triggers reach $< 15$ nodes; the open level interior reaches 60+ nodes. The facing direction $\vec{v}$ is derived from the centroid of nodes reached at 1.5m..4.0m, pointing directly along the interior corridor away from the trigger.
- **Pre-filtered triangle subset**: Filtering mesh triangles within `extent + maxRing + 10m` reduces triangle tests from 20,000+ to ~50–100 per check, accelerating full 150+ portal validation from >30s to <3s.

## Deviations from the original
- Preserving crossing position and yaw across shared-frame level chunks provides seamless MMO transitions without reorienting player cameras.

## Gotchas
- Always pre-filter collision mesh triangles before running BFS or candidate floor evaluation; whole-mesh linear scans in BFS freeze the event loop.
- Client login / title screen (`client/src/frontend/title_scene.ts`) must never be touched.

## How to verify
- `pnpm test:unit unit/portals.test.ts` (10 tests including regression assertion for `ci9b.starts[2]`, shared-frame continuity, pocket rejection, and full 150+ portal network sweep).
- Diagnostic top-down SVGs generated in `local/diagnostics_portals/*.svg`.
