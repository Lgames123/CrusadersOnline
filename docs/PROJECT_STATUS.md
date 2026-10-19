# Project Status: CrusadersOnline

**Status date:** 2026-10-19. This file is a snapshot of where the project stands and what comes
next. The detail lives in the context notes (`docs/context/INDEX.md`, one per commit) and in the
parity audit (`docs/reverse-engineering/parity-audit.md`). The session-by-session log that this
file used to carry (up to 2026-10-14) is in git history.

Direction (agreed with the user): the original's feel by default, quality-of-life changes as
options. Presentation options are per player; gameplay rules are per server
(`GAME_FEATURES`, `shared/src/game/features.ts`).

## 1. Where we are

Milestones M00–M08 are done. M09 (gameplay reconstruction) is far along. M10 has its tests and a
load run with open targets. M11 runs locally in Docker but has no real domain.

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
  - Text chat (Local, Global, Server, Private), hotbar, admin panel (moderation, rate events,
    custom spawns).
  - Spell effects and cooldowns kept across zone changes.

## 2. What comes next

### 2.1 Original campaign: finish the game end to end

| Item | Decision / note |
|---|---|
| **Ending after Necros's death** | The kill is not wired (bs1a's story has no death trigger). Planned (not original): Drake is sent to the start of the game (exact spot to be decided; new games begin in Ws9a) and every story area is open from then on (story-gated triggers, doors and exits treat him as done). He earns a completion reward, still to be decided: a title, a cape or similar. Later: **waypoints**, so a player can teleport to the areas and maps already unlocked. |
| **Intro movies (.bik)** | Option at character creation: "watch the introduction?". The two Bink files need a conversion to a browser format (e.g. WebM) in the import pipeline. |
| **Walk-in movers still at rest** | Wheels, Gl\*b crushers (they need their damage), chandeliers, Bs1a gears. |
| **Creature against creature** | Guards against hostiles; Ws5a's scripted fight. |
| **Relay ops not converted** | 0/1 enable/disable, 2/3, the 0x0A–0x0E creature ops. |
| **Climbing and hanging** | Only the ledge grab is done. |

### 2.2 Side quests (cut from the original, planned as a feature)

26 quests whose records, strings, items and voice lines are still on the disc, but which no act
offers. Some are fetch quests, some deliveries, some kills. Inventory and details are in
[`game-design/side-quests.md`](game-design/side-quests.md). They are to be implemented later as a
non-original feature (`sideQuests`, off by default).

### 2.3 Fidelity: stand-ins still to settle

- **AI and aggro:** only the skeleton's AI is captured; the others reuse it. The 10 m aggro radius
  is a stand-in.
- **Visual stand-ins:** soul drinker's line, snap freeze's glow, the status shells.
- **Not done:** bloodstains and footprints; decals from other players' and creatures' blows; the
  Boomer Axe's catch clip.
- **HUD:** spell recharge whitening and the message line.
- **Engine values:** interaction reach and the lightmap gain (parity audit §4).

### 2.4 Quality of life: decided

| Item | Decision |
|---|---|
| Cooldowns and timers reset on relog | Fine for now; not persisted. |
| Hotbar layout per browser (localStorage) | By design; stays client-side. |
| Chat history | Not needed. |
| Chat ignore list | Worth doing, as a client/browser feature (local list, filtered on display). |

### 2.5 MMO systems (proposals: `game-design/mmo/`, roadmap in `11-implementation-roadmap.md`)

1. **Stage 1, item identity and authority:** mostly in place (authoritative grid, migration 005).
   Item instances with UUIDs and affix payloads are missing.
2. **Stage 2, shared combat and loot:** needs a **party system** (not started), contribution
   tracking and instanced drops.
3. **Stages 3–6:** rarity, affixes and +10 upgrades; trade and auction house; instanced dungeons;
   crafting. Not started.

Trap: the spec names its economy migration `006`, but `006` is already the admin bans migration.
Renumber when the time comes.

### 2.6 Production

- First deployment on a real domain (TLS), off-host backups, metrics.
- **Load:** 100 bots in a real level give a p99 of 13–24 ms (target 15 ms) and about 29 KB/s per
  client (target 5 KB/s); see `performance-testing.md` §3.

## 3. Recommended order

1. Ending after Necros, with the post-game state (all areas open). This makes the campaign
   playable from start to finish.
2. The intro movie option at character creation.
3. Remaining campaign mechanisms (movers, creature against creature, relay ops).
4. MMO Stage 2 (party, then shared loot), which unlocks the later stages.
5. Side quests as a feature, and waypoints, when the post-game loop needs content.

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
