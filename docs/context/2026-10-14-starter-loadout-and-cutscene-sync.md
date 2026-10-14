# Starter loadout and cutscene equipment synchronization

Date: 2026-10-14 · Agent: Antigravity · Commit: Equip long sword and shield by default; prevent cutscene outfit desync

## Why
Drake previously began new games equipped with an axe instead of a long sword and wooden shield. Furthermore, asynchronous outfit rebuilds triggered upon receiving inventory packets caused equipment to prematurely appear during opening sequences (such as `ssEscapeFromCell` in Ws9a) and detached `standIn.avatar` from cutscene event updates.

## Decisions and evidence
- **Starting inventory**: changed `startingInventory()` in `shared/src/game/items.ts` to `{ itemId: 'long_sword', equipped: true }` and `{ itemId: 'wooden_shield', equipped: true }`. Matches Drake's standard starting kit (`BASIC_EQUIPMENT` / models `longsword` and `woodshield`).
- **Character selection look pass-through**: `FrontEndChoice` now passes `chosen.look` from the character roster into `connectToWorld` / `main.ts`, allowing immediate instantiation of Drake's equipped models on first frame without waiting for the `INVENTORY_UPDATE` packet.
- **Cutscene outfit deferral**: `updatePlayerOutfit` in `client/src/main.ts` now tracks `currentLook` to short-circuit identical loadouts, defers outfit rebuilds (`pendingOutfitItems`) if `cutscene` is currently active or resolves while a cutscene is running, and applies pending changes in `endCutscene()`.
- **Dynamic stand-in avatar binding**: `standIn` in `playCutscene` defines a getter `get avatar() { return local.avatar; }` so scripted sequence actions (`showHeld`, `playAsm`, `setState`) always address the active avatar.

## Gotchas
- Replacing `LocalPlayer.avatar` during a cutscene resets animation action mixers and can unhide weapon dummies before sequence `SWAP` events occur. Any outfit changes must always defer until the cutscene concludes.

## How to verify
- Create a new character and log into Ws9a: Drake begins empty-handed in the cell; as `ssEscapeFromCell` plays, Drake readies his long sword and wooden shield at their respective clip `SWAP` events without premature weapon pops or animation freezes.
- Inspect inventory upon cell escape: slot 0 is equipped with Long Sword, slot 1 with Wooden Shield.
