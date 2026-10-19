# Boomer Axe passes the creature it is thrown from

Date: 2026-10-19 · Agent: Claude Code · Commit: Boomer Axe passes the blow's own victim on launch: it now flies out and back visibly

## Why
In game the Boomer Axe still looked like a plain melee weapon: the throw happened, but the axe starts touching the creature just struck, "hit" it on the first tick and was caught again ~0.1 s later (return pace 80 / distance: at 3 ft the curve home takes ~0.06 s). Only the extra 5 + 5 damage showed.

## Decisions and evidence
- Characters the axe overlaps at launch are passed until it is clear of them (swept-collision reading: a body meets what it moves into, not what it starts in). It meets them on the way back as any other.
- Confirmed live (synthetic arena, launch.json `boomer-server` / `boomer-client`, guest with `DEV_GUEST_ITEMS=boomer_axe:1`): out ~18 m in 1 s, back on the curve in ~2.2 s, purple light, right hand empty, caught.
- Player throws only on landed blows in the original too: the other item-use callers of 0x00474550 (0x0046BEB1, 0x0046C077, 0x0046E02C, 0x0046EED4) are potion / quick-item paths; 0x0043EAE0's only other caller is the creatures' THROW_ITEM event (0x0042C7BE).

## Deviations from the original
- The launch overlap rule is an interpretation: the engine's contact test for a just-spawned overlapping body was not traced. If it does report it, the original axe returns at once at melee range.

## Not done / not decoded
- `+0x38(8)` in 0x004C0A50 is the victim's physics flags & 8 (0x004580B0); what sets flag 8 is still unknown (only a clear at 0x004C105E found).

## How to verify
- `pnpm test:unit` (boomer_axe.test.ts "passes the creature it is thrown from inside of").
- Run `boomer-server` + `boomer-client`, equip the axe, strike the skeleton.

## Follow-ups
- Frida capture of the original with a Boomer Axe blow to settle the overlap question.
