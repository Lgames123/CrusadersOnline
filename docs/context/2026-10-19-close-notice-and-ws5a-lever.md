# Creatures notice a player within 7 ft without sight; Ws5a's lever enemies are original

Date: 2026-10-19 · Agent: Claude Code · Commit: Hostile creatures notice a player within 7 ft whatever lies between · Supersedes: the "gates don't block sight" follow-up in 2026-10-19-creature-against-creature.md

## Why
Ws5a's 4 enemies (placements 17–20) fight the player at the lever before it is pulled. We suspected the closed gates didn't block their sight.

## Decisions and evidence
- **Ws5a is original behaviour.** The 4 enemies are not behind the gates; the guards (5–12) are.
  - `bOuterGates` (x 2108–2132, z ≈ −1885 cap ft) is solid in the movement world. The enemies stand on the lever's side, z −1790..−1844.
  - SkeletonWarrior11 is 14 ft from the lever volume (relay 354011) with clear sight. It notices the player, and its call (0x40D360) brings in the other three.
- **0x40D910 hostile pick**, constants read from the exe:
  - squared 3D distance < 49 (0x4DE6A0): the player is taken with no ray. Now `MOB_TOUCH_SENSE_RANGE`.
  - otherwise < 10000 (0x4DE6A4) within 60° (0x4DE69C) of the heading, < 400 (0x4DE698) outside it, plus a clear ray 0x406AF0. As before.
- **Ray 0x406AF0:** from each body's height (+0x68, 3 when unset) × 0.9 (0x4DE668). It skips the two bodies and goes through 0x438280 with query type 10.

## Not done / not decoded
- Whether 0x438280 tests mover brushes or closed doors. Not needed here.
- 0x40D910 has a branch where a local byte (`cStack_4` in Ghidra) is 0: the ray alone at any range. What sets it isn't traced. The server always uses the range branch.
- The original measures every range in 3D. The server keeps its 2D range plus the same-floor height filter (`AGGRO_HEIGHT`). Only the 7 ft check is 3D.

## How to verify
- `tests/unit/close_notice.test.ts`: 7 ft through a wall notices; 14.8 ft behind a wall doesn't; 14.8 ft in the open does.
- Ws5a headless: buildLevelArena('level:ws5a') with the player at (2165, 1040, −1838) ft. After 2 s, 17–20 are chasing and 15–16 are idle.
