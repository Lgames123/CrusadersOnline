# Drake's rolls, jumps and combo as the original

Date: 2026-10-17 · Agent: Claude Code · Commit: Drake rolls on held C, jumps on the clip's take-off frame, combo queues from 10 % of a swing

## Why
Full pass over Drake's movement and attacks against the decompiled code. Reported in play: C + W held did not keep rolling, jumping was faster than running, attack timing felt off.

## Decisions and evidence
- Rolls are level-triggered: the ground selector `0x0042AFC0` asks for ROLL_* every frame C + a direction are held, and the controller `0x00429BF0` loops the roll clips. Held → back to back; W pressed while ducking rolls. The roll lasts to clip time `+0x14` − 1 (PE03 24, others 26 frames; flag 4 at `0x00429257`).
- Jumps: the kind comes from the selector `0x0042BD40` (right / left override forward / back; Shift + forward = kind 9). The impulse fires on the clip's `JUMP LEAVEGROUND` event (handler `0x00457CA0`, the only writer of physics flag `0x8000`): frame 10 (V, F), 6 (running), 12 (L, R, B). Until then Drake stands.
- Jump physics (`0x00492B70` / `0x004923E0`): the drag uses the whole 3-D speed, not the axis' own; vertical travel limit 5.2 ft (×2.3 for V) cancels the hold lift and raises the rising drag to 0.1; kinds 9 / 10 push forward and 20 backwards on their own. A Python model of these rules reproduces the measured standing jump (13.1 ft, 1.17 s). Result: running jump 19.7 ft (was 27), ~17.7 ft/s with the stand, about the run's 17.3.
- Landing with jump held after a V / F / running jump: ASM_LAND_SOFT, 30 % of PD03 (~0.28 s).
- Swings hold to clip `+0x14` − 1 (PN25 17, PN02 24, PN15 22, PN16 27, PN17 30, PN05 42, PP02 24 frames), not RECOVERY + 3. The combo routine `0x0042CA20` runs every frame the button is held and queues the next step from 10 % of the swing; no window after it: a later click restarts at step 1. Holding the button chains the combo.
- Weapon rate = 1 + 1.5 × (Speed − 1) (controller `+0x6C` call in `0x00429BF0`, `0x004DE418`); the shield rush ignores the weapon.
- Details and addresses: executable-analysis.md §11.1 (rolls), §13.1, §14.0.

## Not done / not decoded
- Air velocity stays in world axes; the original keeps it in the body frame (turning mid-air swings the jump at ≤ 80°/s).
- An early landing (short hop onto a ledge) does not keep the jump state to its clip's end.
- The shield held does not clear a queued combo step (`0x0042CA20` does).
- Physics flag `0x20000` (any direction rolls while it is set, likely a forced crouch) not modelled.
- Item `+0x94` read as the weapon Speed by its use; not checked against items.ctx field order.

## Gotchas
- `Character.airKind` is now the ASM jump state (8–12, 20), set during the stand too (timed action 24 with `grounded`); `startTimedAction` on the ground clears it. Snapshot header grew to 36 bytes (vertical travel at 34).
- Rolls chain at the end of the step so `rollDir` never reads 0 between held rolls (else the crouch anim flickers in).
- The client queues one tick after the server's 10 % threshold so it never starts a step the server did not queue.

## How to verify
- `pnpm test:unit` (movement: back-to-back rolls, take-off ticks, jump distances per kind, soft landing; combat: queue / restart, clip-end lengths).
- In game: hold C + W (continuous rolls); a running jump visibly crouches ~0.2 s and lands ~20 ft out; hold LMB (five swings, then over again).

## Follow-ups
- Body-frame air velocity (needs the body turn rate in the shared step).
