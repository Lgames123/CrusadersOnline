# Known Discrepancies: Original vs MMORPG Architecture

## 1. Intentional Architectural Differences

To convert a 1999 single-player desktop game into a secure, persistent browser MMORPG, certain deliberate architectural modifications were implemented:

1. **Server-Authoritative Physics vs Client Hardware Polling:**
   - *Original:* DirectInput sampled keyboard/mouse and moved Drake directly in the local process memory.
   - *CrusadersOnline:* The browser client predicts position locally with the same movement code as the server; the client sends inputs only and the server's simulated position is final (reconciliation corrects any divergence).
2. **Persistent Database Persistence vs Save Shrines:**
   - *Original:* The player walked to shrines to save their game into local files in `Gamers/`.
   - *CrusadersOnline:* State is continuously synced to PostgreSQL; characters persist seamlessly across browser closes and server restarts.
3. **Multiplayer Aggro & Threat vs Single-Player Scripting:**
   - *Original:* Monsters reacted solely to Drake's proximity.
   - *CrusadersOnline:* Monsters maintain dynamic threat tables, balancing attacks between multiple co-op players.
4. **Synthetic Fallback Mode vs Mandatory CD-ROM Files:**
   - *Original:* The game required CD-ROM or local GOG files to boot.
   - *CrusadersOnline:* The browser client runs immediately with synthetic procedural geometry, ensuring zero legal risk and total accessibility.

## 2. Non-Original Behaviours Kept as Features

The parity audit (`docs/reverse-engineering/parity-audit.md`) lists every system against the
original. Behaviours that differ are kept switched off rather than deleted:

- Gameplay (server): `shared/src/game/features.ts` — `reactiveBlock` (creatures block in reaction
  to swings), `sideSwingRetrigger` (side swings re-trigger 0.3 s in, alternating), `diagonalMoves` (diagonals
  run along the diagonal with the body turned). Enable with
  `GAME_FEATURES=reactiveBlock,sideSwingRetrigger,diagonalMoves`; the client receives them in SC_WORLD_ENTER.
- Presentation (client settings, marked "not original"): silhouette shadows, smaller hit effects,
  the modern camera.

## 3. Non-Original Behaviours That Are Always On

Changes made for the multiplayer world or on request. Each has a context note in `docs/context/`.

- **Per character:** ground items, chests and reward shops are taken once per character.
- **Kill loot:** items fall on the ground for the killer alone, for 2 minutes. Gold goes straight
  to the purse.
- **Respawns:** dead players come back at the start of the area. Pits in the Catacombs catch falls
  and return the player to the respawn spot.
- **Creatures:** they stop at ledges and die in deep falls.
- **Unstuck:** in the options menu, with a 30 s cooldown.
- **Zone changes:** spell effects, Torch Light and cooldowns carry across them.
- **Boomer Axe:** thrown on attack (user request).
- **Input:** a movement key closes the inventory windows; holding Alt frees the cursor; there is no
  "click to play" hint.
- **MMO tools:** text chat, hotbar, admin panel.
- **Intro movies:** the original plays 3DO.bik then CMMIntro.bik at every start. Here a new
  character is offered them in the creation dialog (checked by default), and Options →
  Introduction plays them again. Re-encoded to WebM (VP8 + Vorbis) from the player's own files.
- **Ending:** everyone who hurt Necros gets the ending. After Cs5b's last scene, Drake stays in
  Cs5b with the story complete, and every door opens for him from either side.

## 4. Planned Non-Original Features (decided 2026-10-19)

- **Completion reward:** a title, a cape or similar, for characters who finished the story; to
  be decided.
- **Waypoints:** later, so players can teleport to the areas and maps they have unlocked.
- **Side quests:** the 26 cut quests, behind `sideQuests` (`game-design/side-quests.md`).
- **Chat ignore list:** kept in the browser and applied on display. No chat history.

Accepted as they are:

- Cooldowns and timers reset on relog.
- The hotbar layout is saved per browser.

