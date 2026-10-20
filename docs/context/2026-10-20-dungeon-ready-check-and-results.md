# Dungeons: party ready check, sealed instances, objective tracker, results screen

Date: 2026-10-20 · Agent: Claude Code · Commit: Dungeon ready check, sealed instances, objective tracker and results screen

## Why
User feedback on MMO Stage 5. The party had no say before being pulled in. Exits led out of the instance (a player ran to the Glaciers). There were no objectives on screen and no summary at the end.

## Decisions and evidence
- **Ready check** (sessions.ts, main thread):
  - The leader's request asks every member who is in the world and not already in a dungeon (up to `maxParty`). The leader counts as yes.
  - One "no" cancels the run.
  - Everyone saying yes starts it at once.
  - After `DUNGEON_READY_SECONDS` (15), whoever has not answered counts as ready: the user said it starts on silence.
  - A solo player goes in at once.
  - CS_DUNGEON 0x1D `{accept|decline, id}`, SC_DUNGEON_READY 0x5A (ask / update / cancelled / started).
- **Sealed instance**: every exit from a dungeon zone (walk-in, door, scripted, crystal) goes through `portalOut`, which refuses and notes it every 3 s at most. The only ways out:
  - CS_DUNGEON `leave` (Esc → Leave Dungeon, or the results screen);
  - a death: once `PLAYER_RESPAWN_TICKS` run out, `leaveDungeon` revives the player and sends them out instead of respawning them inside.
  - Both go through the outbox `dungeonExit`, then `onDungeonExit`. That leads back to the zone the player entered from (`dungeonReturn` by connection), else the base act, arriving at its crystal.
- **No respawns in an instance**: the act's creatures and the boss's adds are removed when their corpse time ends.
- **Tracker** SC_DUNGEON_STATE 0x5B:
  - bonus objective "Clear the crypt of the dead k/N": the act's hostile, non-custom, non-passive creatures at the run's start;
  - "Defeat Crypt Overlord";
  - a boss bar once engaged (resent every second).
  - The clock starts at the first player's arrival.
- **Results** SC_DUNGEON_RESULT 0x5C, one tick after the boss's death, so they include its rewards:
  - per player: time, killing blows, deaths, XP, gold, the items that dropped for them (`modsTitle` name and colour);
  - `treasure: false` when the daily lockout already paid out.
  - The tally counts from the player's arrival; leaving loses it.
- The crystal is not sent in WORLD_ENTER inside an instance (`waypointTravel` refuses there too).

## Not done / not decoded
- **Ca1d has a single creature placement**, and the boss stands on it, so "clear the crypt" reads 0/1. The crypt is mostly empty: the dungeon needs real content (its own spawns, or a fuller act).
- No reconnection into a running instance: a relog lands in the base act (as before).
- The ready check does not re-check that the leader is still at the crystal when it closes.

## Gotchas
- `dungeonCleared` runs before `grantReward`, which is why the results wait for `resultsDue` on the next tick.
- Members already inside any dungeon instance are left out of a new check.
- The client learns its own name for the ready check from PARTY_UPDATE `self`.

## How to verify
- `npx vitest run unit/dungeon.test.ts` (in tests/): tracker, results, sealed exits, the death exit.
- Live: launch config `dungeon-server` (8196, own pglite DB, guests spawn beside the cs2b crystal) and `dungeon-client` (3106). Checked with two guests: decline cancels, accept enters `level:ca1d@crypt-1`, Leave returns both to cs2b, silence starts the run after 15 s. Seen in the browser: the ready dialog, the tracker, Leave Dungeon in the options menu. The results screen was seen with sample data only; the boss was not killed live.

## Follow-ups
- Give the crypt real encounters (spawn packs along the way) so the clearing objective means something.
