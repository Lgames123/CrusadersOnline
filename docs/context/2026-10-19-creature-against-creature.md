# Creature against creature: targets by disposition, Ws5a's lever fight

Date: 2026-10-19 · Agent: Claude Code · Commit: Creatures pick targets by disposition; Ws5a's lever sets the guards on the hostiles · Supersedes: 2026-10-16-relay-ops.md (its "creatures don't fight each other" deviation and the disposition 4 unknown)

## Why
CMP-005. Relay ops 0x0B, 0x0C and 0x0E did nothing because server creatures never fought each other. "Guards against hostiles" had no rule to follow.

## Decisions and evidence (executable-analysis §18.1)
- **Opposing table** (0x40DC90 = 0x40D790 = 0x40D360): 0–2 oppose 3; 3 opposes 0–2, 5 (the player) and 6; 6 opposes 3 and any 1–2 fighting a player. Kept as `opposes()`. `hostile()` lets two world creatures harm each other when either opposes the other.
- **The pick** (0x40D910): 0–2 take a hostile only with flag 0x400 (relay op 0x0D), otherwise only the alarmed player. 3 takes, in order: an opposing hitter, event 0x17, event 0x18, flag 0x400 nearest, the player in its cone.
  - **So guards against hostiles needs no rule of its own.** In the original they ignore each other unless a relay says otherwise. Only Ws5a's lever does.
  - The hit pass (0x40F890) only flags hits, so an idle guard struck by a creature does nothing.
- **Call to allies** (0x40D360): a creature taking an enemy queues event 0x17 on every non-opposing creature within 4 ft of its height and 100 ft across, within 7 ft, or that sees it (100 ft in the 60° cone, 20 ft outside).
  - Only hostiles read 0x17, and only while idle. Picks that came from an event don't call again.
  - **This is now general group aggro:** hitting or being seen by one hostile pulls the idle hostiles around it.
- **Op 0x0E = disposition 4.** The brain restarts into idle state 8, which does nothing: the creature is inert, opposes nobody and nobody opposes it.
  - Ws5a's relay 353547 is the only user, and nothing in the cap points to it except the type lists (pointer scan), so it never fires.
- **Op 0x0C (0x40C370)** attacks `other` regardless of disposition and calls allies. **Op 0x0B** applies only to idle hostiles.
- The relay ops now also reach peaceful creatures (the old code skipped passive ones).
- **Fight-nearest** creatures pick the next enemy when theirs dies (0x40C830 on event 0x16) and ignore the leash. The original has no leash.

## Deviations from the original
- No friendly fire. Creatures' blows and spells skip their own side. The original's land, and the one struck turns on the striker on rand % 100 < 50 (0x40C830). Not done.
- Admin "aggressive" spawns no longer use the relay flag. `huntsPlayers` keeps their "hunts every player at any range", without the new creature targets.
- Combat between creatures uses the server's threat table (highest damage) instead of the original's immediate switch to a new hitter.

## Not done / not decoded
- 0x41FD10 (sets 3 + flag 0x400 and later restores +0x204): looks like a possession/charm; caller not traced.
- 6 opposing 1–2 creatures fighting a player is in `opposes()`, but `hostile()` still keeps allies off peaceful creatures, so an ally won't fight an alarmed guard.
- Creature-on-creature impacts follow `creatureImpact`. With a constant random, the first blow stun-locks the other: tests need a seeded random.

## Gotchas
- `Mob.disposition` comes from the placement (`mobSpawns[].disposition`, 0–2 for peaceful, no reconversion needed). Without one: 2 if passive, else 3; 6 for the spectral ally.
  - Op 0x0E changes it until respawn (`spawnDisposition`).
- Group aggro changes ordinary fights everywhere, not only Ws5a. Watch for complaints about crowded rooms.

## How to verify
- `pnpm test:unit` (creature_fights: no fight without a relay, lever pairs, nearest + re-pick, idle guard ignores a creature's blow, calls, inert).
- Headless on the converted Ws5a (`buildLevelArena` + `fireTrigger(354011)`): the 8 guards and the 4 named enemies fight, SkeletonWarrior12 is called in, and the enemies die within ~10 s.
- Not checked in the client: Ws5a, Tab on the lever.

## Follow-ups
- Watch Ws5a's fight in the client.
- The 4 enemies behind Ws5a's closed gates already see the player at the lever and hurt him before it is pulled. The gates likely don't block their sight rays. Pre-existing.
- Friendly fire and the 50% switch, if wanted.
