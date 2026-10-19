# Chest loot in the server log

Date: 2026-10-19 · Agent: Claude Code · Commit: Opening a chest, or failing to for a full bag, is written to the server log

## Why
The operator wants to see in the server log what players take from chests, and when a full bag keeps them from it.

## Decisions and evidence
- `WorldZone.interact` reports chests only (not ground items or drops) through a new optional `ZoneOutbox.loot`; it crosses the worker as `{ t: 'loot' }` and `index.ts` logs it at info: `chest looted` (`items` = what was taken) or `chest not looted: inventory full` (`items` = what the chest holds). Fields: conn, character, zone, chest (object id), items.
- Quest items are filtered out of a chest before both messages, as before.

## Gotchas
- An empty chest still logs `chest looted` with `items: []`.
- A full-bag attempt is logged every time the player presses use on the chest; no throttling.

## How to verify
- `tests/unit/inventory_zone.test.ts` "a bag that cannot hold all of a chest takes none of it" checks both events; in game, open a chest and watch the dev server's output.
