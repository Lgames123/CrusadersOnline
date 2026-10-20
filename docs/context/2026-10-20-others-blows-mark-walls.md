# Other players' and creatures' blows mark walls too

Date: 2026-10-20 · Agent: Claude Code · Commit: Every character's blow on a wall throws sparks and leaves its weapon's mark

## Why
Fidelity gap from the decals note (2026-10-18): only the local player's own swings marked walls.

## Decisions and evidence
- In the original, the blade-on-wall routine `0x0048CAB0` runs for any character's swing:
  sparks SWORD_DAMAGE + SWORD_METAL ×3, a clank, and the held weapon's items.ctx `Decal`.
- Client:
  - When a remote entity's replicated swing phase starts over (`swingId`), the client schedules
    the same probe as the local one at its impact frame. Creatures use the archetype's swing
    timing and reach; players use the normal swing.
  - The probe runs from where that entity stands then, along its heading.
  - The decal is the creature's weapon (the placement's held item, else the archetype's) or, for
    other players, SCRATCH. Players' gear is not replicated, so we don't know their weapon.
  - Each client stamps on its own; nothing goes over the network.

## Deviations from the original
- Other players always leave a sword's scratch whatever they hold.

## Not done / not decoded
- Bloodstains and footprints. CLAW, which no item uses.
- Not seen live on a wall: in ca1b, creature swings were detected (7 in 10 s) but they struck
  the player in the open.

## How to verify
- Stand with your back to a wall in front of a skeleton (monsters-server). Its misses that reach
  the wall leave a mark and sparks.
