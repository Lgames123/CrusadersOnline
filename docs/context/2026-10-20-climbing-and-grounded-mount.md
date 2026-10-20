# Climbing is unreachable in the shipped game; the ledge grab now works on the ground too

Date: 2026-10-20 · Agent: Claude Code · Commit: Drake climbs onto a 3-4.5 ft ledge he walks into; climbing walls settled as unreachable · Supersedes: the "grounded case" reading in 2026-10-18-ledge-grab.md, and the "loader switch not decoded" item in 2026-10-20-relay-flag-ops.md

## Why
CMP-007 (climbing and hanging) was the last campaign mechanism left in PROJECT_STATUS §3.

## Decisions and evidence (executable-analysis §13.2)
- **Climbing is never offered.** Attaching to a wall (physics flag 0x40) needs physics flag 0x200.
  - Only the climb volume sets that bit: cap type 0x0C, vtable 0x4E1CA4 (0x461790 / 0x4617E0 set it, 0x4617C0 clears it).
  - The entity's flag test, vtable +0x38 (0x4580B0), reads physics +0x60.
  - No act has a type-0x0C object. So HANG, CLIMB_*, CLIMB_TO_HANG and HANG_MOUNT never play. HIGH_MOUNT doesn't either: the ledge test always sets 0x800.
- **Loader switch decoded** (0x478511): byte table 0x479958 indexed by type − 3, then the jump table 0x47984C. Climb = 0x0C, proxy = 0x0A, flag-compare = 0x23. None of the three is in any act.
- **The ledge test was misread earlier.** `0x004912F0` passes when grounded (flag 1) **or** when `+0x144 − y ≤ 2`.
  - `+0x144` is the highest y of the airborne stretch (0x492960, which also gives the fall damage on landing).
  - So walking into a ledge 3–4.5 ft high pulls Drake up: 4.5 ft up must be open and the top must be over 3 ft above his feet.
  - In the air, he grabs only within 2 ft below the top of the flight.
- **Drake only.** The physics class that runs the test (vtable 0x4E26DC, built at 0x43CFBA beside his controller 0x42C9D0) is unique to him. Creatures get `MovementStats.noLedgeGrab`.
- **BSP only.** The open-point test (0x4395F0) and the trace (0x438760) see the level BSP. `MovementWorld.level` (arena boxes and meshes) now filters both queries, so props and brushes (crates, Ca*b planks, doors) are never mounted. The capsule-fit check still sees everything.

## Deviations from the original
- The 2 ft window comes from the falling speed (v²/2g; falling has no drag, and there's no lift with jump released) instead of a tracked peak. That keeps snapshots unchanged. It's slightly lenient if jump was held earlier in the fall.

## Not done / not decoded
- Climbing itself: not implemented, since it's unreachable in the shipped game. The decoded selector (0x42C310) and attach test (0x490E80) are in §13.2 if a non-original option is ever wanted. That would need invented climb volumes.
- Not seen in the client. Candidate spots: any 3–4.5 ft level step or low wall.

## Gotchas
- Every arena wall, step or parapet 3–4.5 ft high now mounts when walked into while facing it. That's original, but it's new here; watch for complaints about railings.
- A `MovementWorld` built by hand needs `level`. Only `createMovementWorld` builds one today.

## How to verify
- `pnpm test:unit`, movement: grounded mount onto a 1.1 m block; no mount at the 4 m pillar; no grab 3 m into a fall; no mount on a prop; none for creatures.
