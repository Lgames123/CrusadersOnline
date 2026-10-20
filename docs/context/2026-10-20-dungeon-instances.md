# MMO Stage 5: dungeon instances and the Crypt Overlord (feature `mmoDungeons`)

Date: 2026-10-20 · Agent: Claude Code · Commit: Dungeon instances with a phased boss behind GAME_FEATURES=mmoDungeons (MMO Stage 5)

## Why
MMO roadmap Stage 5 (docs/game-design/mmo/06): instanced group content with a boss.

## Decisions and evidence
- **Behind `mmoDungeons`, off by default.** The original world stays untouched.
- **Instance = a zone of its own** named `level:<act>@<dungeon>-<n>` (`shared/src/game/dungeons.ts`):
  - the worker loads the base act; the zone keeps the full name, so the dungeon state is its own;
  - `ZoneManager.available` accepts only a known dungeon on its own act;
  - the client shows the base act; the character is **saved as the base act** (the instance
    ends with its run);
  - empty instances stop like any idle zone (5 min).
- **Entry:**
  - the waypoint crystal's map lists the dungeons (a finished story only, at the crystal);
  - entry "dg-crypt" → the zone asks the session → the party leader (or a lone player) and
    every party member in the world (up to 5) go into a new instance, beside its crystal.
- **The Crypt Overlord** (Ca1d):
  - the act's own creatures are the way in; the boss is a 1.6× Greater Black Knight, 3000 HP,
    ×2.5 damage, at the hostile placement farthest from the arrival;
  - phase 2 below 75 %: three skeleton adds;
  - phase 3 below 40 %: a slam on a player every 8 s, shown first as a **red circle**
    (`SC_TELEGRAPH`, 1.5 s, 4 m, 45 damage, unblockable);
  - soft enrage after 6 min, +10 % damage every 30 s;
  - **a wipe** (everyone in the zone dead) resets the boss and removes the adds.
- **Rewards:**
  - shared like any kill (rewards.ts), 3000 XP;
  - gold 500–800 and one piece of gear (Tempered or better with `mmoItems`) **once a day per
    character**: story flag `dg-crypt:<day>` (fits STORY_FLAG, saved with the story);
  - after that, XP only.

## Deviations from the original
- MMO content, optional.

## Not done / not decoded
- No keystones (a daily lockout instead), no fog gate, no reconnection reservation, no
  interruptible channel, and no soul siphon or flame trails from the spec's encounter.
- Instance members cannot be summoned in later: whoever is in the world at entry goes.

## Gotchas
- `run` starts on the first tick (`startDungeon`), after the waypoint spot exists.
- A boss is a custom spawn (`custom.damage` is its multiplier; the enrage raises it).

## How to verify
- `pnpm test:unit dungeon` (instance names; the boss, adds, a telegraph, the wipe reset, the
  lockout flag on Ca1d).
- Live: server `GAME_FEATURES=mmoDungeons DEV_GUEST_FINISHED=1 ARENA=level:cs2b`, guest, Tab at
  the crystal → "The Crypt of the Catacombs". Logged "dungeon run" and the guest entered
  `level:ca1d@crypt-1` (checked).
