# Snap freeze and soul drinker draw nothing of their own

Date: 2026-10-20 · Agent: Claude Code · Commit: Snap freeze flies unseen and soul drinker draws no line, as their objects have no look

## Why
Visual stand-ins: a glowing ball for the flying snap freeze and a red line for soul drinker's
drain.

## Decisions and evidence
- Object pool factories (`0x4E2384`):
  - type 4, snap freeze: `0x0043EC80`;
  - type 7, soul drinker: `0x0043F700`.
  - Both set the object's render component (+0x48) to 0. They have physics, a mover and a
    behaviour, but no model or sprite.
- The freeze behaviour (vtable `0x4E34EC`):
  - update `0x004C10D0` counts its life down and spawns SNAPFREEZE_TARGET (0x1F) where it ends;
  - hit level `0x004C12E0` spawns SNAPFREEZE_FIZZLE (0x29) and a FROST decal;
  - hit character `0x004C1130` applies and stamps FROST.
  - Nothing is carried in flight. The cast shows SNAPFREEZE_CAST at the hand (`0x004BB5CE`).
- The soul drinker behaviour (vtable `0x4E04B8`) spawns no effect in its own slots.
  SOULDRINKER_CAST comes from the cast (`0x004BC4D5` / `0x004BD989`).
- Client: the freeze sprite is gone. The drain's line is kept invisible, as the path along which
  the energy effect spawns.

## Not done / not decoded
- Who spawns SOULDRINKER_TARGET_* / CASTER_* / ENERGY: no direct `push id` call to 0x481FC0 /
  0x481E30, so they come through a computed id. The energy flowing along the drain stays a
  reading.

## How to verify
- spells-client: snap freeze leaves the hand with its cast effect and shows only where it lands.
  Soul drinker shows the energy effects, no line.
