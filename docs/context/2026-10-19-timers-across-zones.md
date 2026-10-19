# Spell effects and cooldowns carry across zone changes

Date: 2026-10-19 · Agent: Claude Code · Commit: Spell effects, Torch Light and cooldowns carry on across a zone change

## Why
User request: changing maps dropped active spells (heroism, stone skin, boosts…), the torch light and potion / Unstuck cooldowns, since every zone builds the player afresh.

## Decisions and evidence
- `leaveForTransfer` adds `carried` (`CarriedTimers`) to the TransferState: statuses (full ActiveStatus minus `until`), light, potion cooldown groups, Unstuck, all as seconds left + `at` = Date.now(). Zone ticks are per worker, so absolute ticks can't cross.
- `join` restores them after WORLD_ENTER and before PLAYER_STATS / INVENTORY_UPDATE, minus the wall-clock time since `at` (the load counts, so nothing is gained by zoning). Statuses go through `SpellRuntime.restoreStatus` → setStatus (refreshDerived, SPELL_EVENT); SLTI re-pushes its world slow.
- Dead players carry no statuses or light (cooldowns still carry).

## Deviations from the original
- Not original (one level at a time there; a level load ends nothing because nothing else runs). Always on.

## Not done / not decoded
- Logins/relogs still start clean: timers are not persisted (relog resets potion cooldowns).
- Not carried: a cast in progress, spectral ally, drains, lightning chains, mana regen tick.

## Gotchas
- A new timed player field must be added to `carriedTimers` / `restoreTimers` or it resets on zoning.
- The unstuck note's "cooldown resets on zoning" no longer holds.

## How to verify
- `tests/unit/zone_transfer_timers.test.ts`; in game: cast Heroism + Torch Light, drink a potion, walk through an exit: the HUD statuses, light and hotbar cover continue.
