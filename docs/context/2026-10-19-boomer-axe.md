# Boomer Axe throws its magic axe

Date: 2026-10-19 · Agent: Claude Code · Commit: Boomer Axe: each landed blow throws the axe itself, out 1 s at 60 ft/s and back along a spline to the hand

## Why
Follow-up of the gear pass: the Boomer Axe swung but its BOOMER use (the thrown magic axe) did nothing.

## Decisions and evidence
- Decoded in executable-analysis §23.1: pool type 3 = "Axe" (factory 0x0043E850, behaviour 0x004C0420, vtable 0x4E3468 over the arrow's 0x4E3400). The throw takes the weapon itself out of the hand (0x0046B150): the wielder fights unarmed until the catch (0x0046B000).
- Out 1000 ms (+0x48) at 60 ft/s from the hand node (`SpellRuntime.hand`), along the player's view (pitch included) / a creature's facing; first character or wall turns it back.
- Damage SLASH 5 + AIR 5 through the victim's resists (stats +0x48), push 3 ft along the flight; a raised shield with MELEE stops it (sparks). Sounds 306/307 on a character, 328/206 + SCORCH on the level (identifies 0x004C0BD0 from the decal notes).
- Return: natural cubic spline, keys t 0..3 (here, 0.25 and 0.5 of the way pushed sideways rand × 0.3 on alternate sides, the hand 3 ft to the side and 6 ft up), pace 80 / distance (ft) per second, caught at t ≥ 3 − 0.05 × pace. `naturalSpline` reproduces 0x004C2BF0.
- Pool of 8 axes per zone; none free → no throw (weapon stays in hand).

## Deviations from the original
- The item stays in the saved inventory; only the zone treats the hand as empty (`weapon = UNARMED`, `inventoryBusy`, equip requests deferred to the catch like a swing). So the original's "hand full on return → the axe strikes its wielder and drops as a ground item" (0x004C0ED0) never happens.
- Each character is hit once per throw (the original re-tests contact every frame; turned back at a victim, it would meet it again at once). Walls do not stop the return (velocity forced each frame; the catch is by t anyway).

## Not done / not decoded
- The catch clip (controller flag 0x200000 at t ≥ 3 − 0.15 × pace) is not played.
- The victim's `+0x38(8)` test in 0x004C0A50 (also ends in sparks) is unidentified; ignored.
- Hand offset's local +x read as the wielder's right (frame not checked). Spin axis on the client is a guess (the original turns its second Euler angle).
- Creatures' ASM_THROW_ITEM throws (0x0042C7BE) are still not wired; a creature wielding a Boomer Axe in melee now throws on landed blows like the player.

## Gotchas
- `applyEquipment` keeps `UNARMED` while `BoomerAxes.flying(p)`: anything that re-derives gear mid-flight stays consistent; the catch calls it again and applies a pending equip.
- Client: `SpellEventMsg.axe` hides / shows the owner's right hand (`showHeld`); a re-dress mid-flight shows the axe in hand again.

## How to verify
- `pnpm test:unit` (boomer_axe.test.ts: spline, flight times, hit, wall, zone throw and catch).
- In game (not checked this session): wield a Boomer Axe (admin grant), strike a creature: the axe spins out purple, comes back curving and returns to the hand.

## Follow-ups
- Play the catch clip; decide on the hand-full branch if weapon swaps mid-flight are ever allowed.
