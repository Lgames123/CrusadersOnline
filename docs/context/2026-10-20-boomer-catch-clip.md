# The Boomer Axe's catch plays the throw clip again

Date: 2026-10-20 · Agent: Claude Code · Commit: Catching the Boomer Axe plays its catch clip

## Why
Fidelity gap from 2026-10-19-boomer-axe.md: the catch clip was not played.

## Decisions and evidence
- §23.1: on the way back, crossing t = 3 − 0.15 × pace with an empty hand raises the wielder's
  controller flag 0x200000 (constant `0x4E34E0`). That flag is the THROW_ITEM / FIRE_BALL group
  (§20), which is Drake's BOOMER_THROW clip. The catch itself follows at t ≥ 3 − 0.05 × pace.
- Server (`BOOMER_RULES.catchFlagAt` 0.15):
  - it raises the flag once per flight;
  - a player who is alive, grounded and not swinging, casting or in another item action gets
    `itemAction` BOOMER_THROW, so others see it in snapshots;
  - the axe event carries `catching: true`, and the owner's client starts the same item action.
- Creatures keep their own clips.

## How to verify
- boomer-server + boomer-client, equip the axe, attack. Live: throw at 0 s, catch clip at
  2.73 s, axe back at ~2.95 s.
