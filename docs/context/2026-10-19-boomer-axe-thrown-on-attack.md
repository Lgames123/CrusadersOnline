# Boomer Axe is thrown on attack, never swung

Date: 2026-10-19 · Agent: Claude Code · Commit: Boomer Axe is thrown on attack, near a foe or not: no melee swing · Supersedes: 2026-10-19-boomer-axe-launch-overlap.md (for the player's trigger)

## Why
User request: a ranged weapon swung at melee range made no sense; the attack itself should throw it, fly to full range and come back, turning back early at a wall.

## Decisions and evidence
- An attack with the Boomer Axe in hand (and not in flight) plays BOOMER_THROW and launches the axe at its release; no swing, no landed-blow trigger for the player. Flight, damage, wall turn and return are unchanged (§23.1, `boomer_axe.ts`).
- BOOMER_THROW = ASM_SPELL_FIRE_BALL's clip (29 frames, release frame 12): Drake has no ASM_THROW_ITEM clip, and THROW_ITEM falls back to its group's FIRE_BALL state (0x00428220, table 0x004EBD18, §20). Played as an item action (rooted standing, upper body on the move).
- While it flies attacks are unarmed punches; the throw needs the feet down, no item action playing.
- Client knows the weapon from `InventoryItemView.boomer` and the flight from `SpellVisuals.axeOut`.

## Deviations from the original
- Always on: in the original Drake swings the Boomer Axe and each landed blow throws it (0x0044D59A → 0x00401000). Creatures keep the original trigger (landed blows).

## How to verify
- `pnpm test:unit` (boomer_axe.test.ts "an attack throws it with no foe near").
- launch.json `boomer-server` + `boomer-client`, equip the axe, click: thrown at 0.4 s, ~18 m out, caught ~3.2 s; at a pillar it turns back early. Checked live this session.
