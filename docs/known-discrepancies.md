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
  to swings), `sideSwingFullClip` (side swings play their whole clip). Enable with
  `GAME_FEATURES=reactiveBlock,sideSwingFullClip`; the client receives them in SC_WORLD_ENTER.
- Presentation (client settings, marked "not original"): silhouette shadows, smaller hit effects,
  the modern camera.
