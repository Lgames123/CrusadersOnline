# Jumping at a ledge pulls Drake up onto it

Date: 2026-10-18 · Agent: Claude Code · Commit: Drake catches a ledge in the air and pulls up onto it (ASM_LOW_MOUNT)

## Why
Requested: "Grab ledge jump". The original pulls Drake up onto a ledge he jumps at; we had no grab at all.

## Decisions and evidence
- Decoded in executable-analysis.md §13.2: per-frame `0x004916A0` → ledge test `0x004912F0` → LOW_MOUNT (0x3E). The test: in the air, jump **not** held (key byte `0x58B9DC`), a wall touched this frame with |n.y| ≤ 0.1 faced within acos 0.8; P = feet + 4.5 ft up + 2.21 ft ahead open; trace P → feet + 1.5 ft meets a top > 3 ft above the feet. Target = (P.x, top, P.z).
- Implemented in the shared step (`ledgeAhead` / `ledgeAt`, server and prediction alike): position set to the target at once, timed action 26 (`ACTION_MOUNT`) for PF01's 26 frames (`mountTicks`, 16 ticks), ANIM.MOUNT_LOW = 60.
- Converter 1.28 keeps the root motion of the mount clips (like death clips): PF01 is authored about where it ends, so with the character already at the target the clip carries the body up from where it hung. Checked in game on a synthetic-arena pillar: no pop at the start or the end.
- Jumps are ~13 ft high, so low ledges (the 1.5 m platform) are simply jumped onto; the grab matters for ledges about 7–13 ft up.

## Deviations from the original
- The original's target is 1.5 ft below the top and its collision lifts the body out; here the feet go on the top and the capsule must fit there (else no grab).
- y snaps to the target at once (the original raises it by the clip's root speed); the clip's own root motion shows the climb.
- The test is also tried at the heights a 20 Hz tick passed through (every 0.2 m): the original ran it every frame and its window is only 1.5 ft.
- Facing is the view yaw, not the rate-limited body yaw. Ray/point queries are Rapier's, not the BSP (on trimeshes "point in solid" is weak; the capsule-fit check is the real guard).

## Not done / not decoded
- Climbable walls (`0x00490E80`), hanging (HANG, CLIMB_*), HANG_MOUNT / HIGH_MOUNT, walking into a ledge on the ground (`+0x144` unknown).
- Clip sound events of PF01 (GRUNT, footsteps) only if the client's generic clip-event sounds pick them up; not checked.

## Gotchas
- rollDir 26 is the mount: anything adding timed actions must not reuse it; the snapshot carries rollDir in 5 bits.
- Bump `MANIFEST_VERSION` and reconvert, or the mount clip plays in place 2.15 ft behind Drake.

## How to verify
- `pnpm test:unit` (movement: pillar grab, no grab with jump held).
- Offline synthetic arena: stand against a 4 m pillar, jump, release jump and hold forward: Drake climbs on top.

## Follow-ups
- Climbing and hanging (`0x0042C310` selector, `0x00490E80`), which need the levels' climbable surfaces.
