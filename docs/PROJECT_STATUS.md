# Project Status: CrusadersOnline

**Status date:** 2026-10-20. This file is a snapshot of where the project stands and what comes
next. The detail lives in the context notes (`docs/context/INDEX.md`, one per commit) and in the
parity audit (`docs/reverse-engineering/parity-audit.md`). The session-by-session log that this
file used to carry (up to 2026-10-14) is in git history.

Direction (agreed with the user): the original's feel by default, quality-of-life changes as
options. Presentation options are per player; gameplay rules are per server
(`GAME_FEATURES`, `shared/src/game/features.ts`).

## 1. Where we are

Milestones M00–M08 are done. M09 (gameplay reconstruction) is far along. M10 has its tests and a
load run: the bandwidth target is met, the tick p99 target is not. M11 is ready to go live but has no real
domain yet. All six MMO stages are in, each behind its own `GAME_FEATURES` flag (off by default).

**Done**

- **Platform**
  - Authoritative 20 Hz server with one worker per zone, prediction and reconciliation.
  - PostgreSQL through Kysely (PGlite in development).
  - argon2id accounts, sessions and WebSocket tickets.
  - Docker and CI.
  - The converter runs in the browser (import panel and service worker).
  - Zone changes happen without a page reload.
- **World**
  - 24 of 25 original levels, with lightmaps and collision.
  - Placements by difficulty, portals and arrivals as in the original.
  - Doors from the original's triggers, keys and sides.
  - Levers, the Catacombs' floor and swinging bridges.
  - Signs and hints; the respawn spot, fall catches and Unstuck.
- **Combat and movement**
  - Original movement, camera, jumps and rolls; ledge grab.
  - Five-step combo, shield and rush, hit reactions.
  - All 11 spells, creature casters, elementals, Necros, Boomer Axe.
  - Impact decals.
- **Items**
  - MU-style inventory and paper doll; rings and accessories; equip boosts, shield masks.
  - Potions with cooldowns and boosts.
  - The original shops; per-character pickups and chests.
  - Quest items and key items; kill loot on the ground.
- **Story**
  - Cutscenes and the main quests, decompiled and played.
  - Quest book (F2), character sheet (F1).
- **Presentation**
  - Classic HUD.
  - Optional: grass and bushes, object shadows, dynamic lights.
  - Original effects, sprites and sounds.
- **MMO**
  - Text chat (Local, Global, Server, Private) with an ignore list, hotbar, admin panel
    (moderation, rate events, custom spawns).
  - Spell effects and cooldowns kept across zone changes.
  - Waypoint crystals after the story.
  - Parties of five with kills shared by contribution.
  - Behind flags:
    - item rarity, affixes and +10 refinement (`mmoItems`);
    - dungeon instances with a phased boss (`mmoDungeons`);
    - mining, smithing and salvaging (`mmoCrafting`).
  - Always on: direct trade, and the auction house with a mailbox.
- **Operations**
  - `/metrics` (Prometheus) and a 45 ms tick alarm in the logs.
  - Daily dumps plus an optional encrypted off-host copy (rclone, `--profile offsite`).
  - A go-live checklist in `deployment.md` §7.

## 2. What comes next

### 2.1 Original campaign: finish the game end to end

| Item | Decision / note |
|---|---|
| **Ending after Necros's death** | **Done** (2026-10-19, executable-analysis §24). As the original: the death timeline, then Cs5b and Seq24. Not original: everyone who hurt Necros gets it; Drake stays in Cs5b; the completion date is saved (`StoryState.completedAt`); every door opens for him from either side. Still open: the **completion reward** (left open by the user). |
| **Waypoints** | **Done** (2026-10-20). A teleport crystal in each of the 81 campaign acts (none in the training level or the inns), shown only to characters who finished the story. Tab opens a map split into the story's five chapters; the player arrives beside the destination's crystal. Not original. |
| **Intro movies (.bik)** | **Done** (2026-10-19). The converter turns 3DO.bik and CMMIntro.bik into WebM (VP8 + Vorbis): `pnpm convert` with the player's own ffmpeg, the in-browser importer with ffmpeg.wasm fetched from a CDN at import time. The creation dialog offers the introduction (checked by default); it plays 3DO then the intro, skippable as in the original, then enters the world. Options → Introduction plays it again. No converted movie: no offer. |
| **Walk-in movers** | **Done** (2026-10-19, CMP-004). Ci\*b wheels, Gl\*b crushers, the inns' chandeliers and Bs1a's gears start when walked under. Crushers do no damage in the original (decompiled): one landing on a player waits on his head and falls on once he moves. Not original: movers hold instead of pushing; a fallen crusher stays down until the zone restarts. |
| **Creature against creature** | **Done** (2026-10-19, CMP-005, executable-analysis §18.1). Creatures pick targets by disposition as the original. Without a relay, guards and hostiles never take each other on, so only Ws5a's lever starts a guards-against-hostiles fight. A hostile that takes an enemy calls the idle hostiles near it. Relay op 0x0E makes a creature inert (no shipped act fires it). Not checked in the client yet. |
| **Relay ops 0–3** | **Settled, nothing to do** (2026-10-20, CMP-006). They only set flag bits; in the shipped acts no trigger reads the bits they set (asset-format-discovery, type 0x2B). The converter keeps them as `flagOps`; the server ignores them. |
| **Climbing and hanging** | **Settled** (2026-10-20, CMP-007, executable-analysis §13.2). Climbing and hanging need a climb volume (cap type 0x0C), and no act has one, so the shipped game never climbs. The ledge grab now also works on the ground, as in the original: walking into a ledge 3–4.5 ft high climbs onto it. In the air it works only within 2 ft below the top of the flight. Level geometry only, never props; players only. Not checked in the client yet. |

### 2.2 Side quests (cut from the original, planned as a feature)

26 quests whose records, strings, items and voice lines are still on the disc, but which no act
offers. [`game-design/side-quests.md`](game-design/side-quests.md) is now the full reference for checking by
hand:
- how each quest works, its objectives and its rewards;
- the reward lists decoded from `0x498AE0`.

Quest 23 cannot be finished as recorded. Implementing them (`sideQuests`, off by default) waits
on the user's review of that document.

### 2.3 Fidelity: stand-ins

All settled on 2026-10-20 (context notes of that date):
- **AI:** every hostile type runs the same brain; they differ by data only, and there are no archers.
- **Visuals:** snap freeze and soul drinker draw nothing of their own in the original.
- **Not done before, now in:**
  - footprints, body thuds and bloodstains;
  - wall marks from other players' and creatures' blows;
  - the Boomer Axe's catch clip.
- **HUD:** the three text lines and the spell icon's flash.
- **Interaction reach:** 3D, √96 ft.

**Waiting on the user:** the lightmap gain. The executable applies ×1, and only the Brightness gamma
brightens; we draw ×2. That stays until the user decides.

### 2.4 Quality of life: decided

| Item | Decision |
|---|---|
| Cooldowns and timers reset on relog | Fine for now; not persisted. |
| Hotbar layout per browser (localStorage) | By design; stays client-side. |
| Chat history | Not needed. |
| Chat ignore list | **Done** (2026-10-20): /ignore, /unignore, /ignored, right-click a name; kept per browser. |

### 2.5 MMO systems (proposals: `game-design/mmo/`, roadmap in `11-implementation-roadmap.md`)

All six stages are implemented (2026-10-20). Each has a context note with its numbers and gaps.

| Stage | What | Switch |
|---|---|---|
| 1 | Item instances with a uid and mods (migration 007) | always |
| 2 | Parties of five, kills shared by contribution | always |
| 3 | Rarity, affixes, +10 refinement, materials | `mmoItems` |
| 4 | Direct trade; auction house with escrow, deposit, tax and a mailbox (migration 008) | always |
| 5 | Dungeon instances (the Crypt under Ca1d) with a phased boss | `mmoDungeons` |
| 6 | Mining, smithing, salvaging (migration 009) | `mmoCrafting` |

Known gaps:
- the auction house was not run end to end in the browser;
- the recipe and economy numbers are first-pass values (doc 10's scenarios not re-run);
- ore veins and dungeon runs are not saved across a zone restart.

### 2.6 Production

- **Load:** 100 bots in `ca1a` now take **4.3 KB/s per client**, under the 5 KB/s target; the
  rate was 22.2 KB/s before (snapshot-bandwidth note).
- **Tick p99:** still 18–31 ms against the 15 ms target. That varies run to run on this desktop;
  about 65 % of the tick is the character controller. Measure on the production host.
- **Ready:** TLS through Caddy, `/metrics`, off-host backups and the go-live checklist
  (`deployment.md` §7).
- **Left:** the first real deployment, which needs the operator's domain and host.

## 3. Recommended order

1. Go live on a real domain (`deployment.md` §7), then measure the tick on that host.
2. The user's decisions:
   - the lightmap gain (×1 as the executable, or keep ×2);
   - the completion reward;
   - the side-quest review, then implement them behind `sideQuests`.
3. Play-test the MMO stages with their flags on, balance the crafting and economy numbers, and
   run the auction house end to end.

## 4. Where to look

| Need | Document |
|---|---|
| What each change decided, and its gotchas | `docs/context/INDEX.md` |
| Each system against the original | `docs/reverse-engineering/parity-audit.md` |
| Decompiled addresses and formulas | `docs/reverse-engineering/executable-analysis.md` |
| File formats | `docs/reverse-engineering/asset-format-discovery.md` |
| Unknowns still open | `docs/reverse-engineering/unknowns.md` |
| Non-original behaviour kept as options | `docs/known-discrepancies.md` |
| MMO design | `docs/game-design/mmo/README.md` |
