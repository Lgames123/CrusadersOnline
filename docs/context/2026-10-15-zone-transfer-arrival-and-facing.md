# Zone transfer arrival positioning and facing synchronization

Date: 2026-10-15 · Agent: Antigravity · Commit: Fix zone transfer arrival facing and prevent portal bounce loops · Supersedes: 2026-10-14-citadel-portal-network-fixes.md (arrival selection and facing sections)

## Why
- Transitions between zones (specifically `ci9a <-> ci9b` and network-wide) caused Drake to spawn behind or beside the return trigger while preserving his prior zone facing, causing him to face the trigger. Holding W immediately re-entered the return trigger, creating infinite map-transition bounce loops.

## Decisions and evidence
- **Decompiled start table dispatch (`crusaders.exe` at `0x476F20` / `loadlevel.c`)**:
  - The original engine indexes the Cap file's start point table (`CapType 0x06` at offset `0x20`, 28 bytes per entry `[x, y, z, pitch, yaw, roll, ?]`) using `DAT_0058d0ce * 7` into `_DAT_0058c9a0`.
  - When a portal's `exit` index matches a valid start record that has walkable floor and is outside the return trigger, that start position and yaw are used directly.
  - Where the Cap start record is dummy/camera data (off-mesh coordinates with null floor), or `portal.exit` is not an index into `starts`, the geometric fallback is used.
- **Geometric interior direction and facing derivation**:
  - Outward normals $\vec{n} = (n_x, n_z)$ are calculated along trigger polygon edges and radial sweep directions.
  - In `physics.ts`, forward movement is $\vec{d} = (-\sin \text{yaw}, -\cos \text{yaw})$. Thus, outward normal facing is $\text{yaw} = \text{atan2}(-n_x, -n_z)$.
  - Candidate arrival points are tested along outward normals with safe margin rings ($1.2\text{m} \dots 18\text{m}$), verifying:
    1. The arrival point is outside all portal triggers.
    2. A forward walk along the spawn yaw for $0.5\text{m} \dots 4.0\text{m}$ does NOT re-enter any portal trigger.
    3. Continuous walkable floor exists ahead into the interior of the level.
- **Client/Server yaw synchronization**:
  - `WorldZone.join()` in `server/src/simulation/world_zone.ts` sets `p.yaw = quantizeAngle(arrival.yaw)` on portal arrival.
  - The server broadcasts `yaw: dequantizeAngle(p.yaw)` in `SC.WORLD_ENTER`.
  - In `client/src/main.ts`, the client sets `input.yaw = enterYaw` and calls `chase.snap()`, orienting the camera behind Drake facing into the level with zero snap-back.

## Portal Network Verification Results
- Evaluated all 192 portals across 84 levels in `local/generated/levels/*.placements.json` (157 two-way transitions, 35 one-way/cutscene exits):
  - **Before**: 129 out of 157 two-way transitions failed (re-entering return trigger within 3m when walking in prior heading; arrival placed beside/behind trigger).
  - **After**: 0 failures out of 157. 100% of arrivals land outside return triggers and clear 3.5m–4m forward walking without re-entering.

## Gotchas
- When testing forward walk on sloped or multi-level staircases, test floor heights relative to column floor rather than flat Y to avoid false positives on stairs.
- Keep `PortalDef.exit` in sync with placement data so start table indices are preserved.

## How to verify
- Run unit test suite: `pnpm test:unit` (`tests/unit/portals.test.ts` asserts `ci9a <-> ci9b` and the entire 157-portal network sweep).
- In-game: walk between `ci9a <-> ci9b` holding W continuously in both directions; Drake lands facing into the corridor/room and continues walking without bouncing back.
