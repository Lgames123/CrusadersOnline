# Milestone 09: Gameplay Systems Reconstruction

## 1. Objective
Expand the vertical slice into full gameplay reconstruction by integrating combat combos, spellcasting, inventory grids, NPC dialogue, and multi-zone transitions.

## 2. Prerequisites
- Milestone 08 (Vertical Slice) verified passing all 14 criteria.

## 3. Implementation Steps
1. Reconstruct 3-hit weapon combo timing and damage multipliers.
2. Implement spellbook system (Fireball, Lesser Heal, Lightning Bolt).
3. Implement inventory equipment paperdoll and bag grid UI.
4. Integrate NPC dialogue and shop interaction states.
5. Expand parity matrix to >80% verified features.

## 4. Acceptance Criteria
- [x] The combo strikes (the original has five, 0x0042CA20) execute with their clip-event recovery windows.
- [x] Spells consume server-validated mana and trigger spatial area-of-effect spells (all 11).
- [x] Inventory swaps are authoritative and persisted (inventory authority, migration 005).
- [x] NPC talk lines and the original shops.
- [ ] The campaign can be played to its end (ending after Necros: `PROJECT_STATUS.md` §2.1).
