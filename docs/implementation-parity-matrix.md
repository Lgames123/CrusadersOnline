# Implementation Parity Matrix

## 1. Status Legend & Tracking Conventions

Every mechanic from the original 1999 game is tracked against our clean-room implementation:
- `NOT_INVESTIGATED`: Mechanic noted from gameplay but not yet analyzed.
- `INVESTIGATING`: Active analysis in progress.
- `SPECIFIED`: Documented in specifications with math and behavior rules.
- `IMPLEMENTED`: Code written in client or server.
- `TESTED`: Passing automated or manual test suites.
- `VERIFIED`: Confirmed indistinguishable from original game feel.
- `KNOWN_DISCREPANCY`: Differs from original due to technical engine constraints.
- `CHANGED_FOR_MULTIPLAYER`: Intentionally altered for MMORPG balance, persistence, or network security.

---

## 2. Parity Tracking Table

Updated 2026-10-19. The system-by-system evidence is in `reverse-engineering/parity-audit.md`; this
table only gives the state.

| Subsystem | Mechanic | Original 1999 Behavior | MMORPG Reconstruction | Status | Notes |
|---|---|---|---|---|---|
| **Movement** | Run / retreat / sidestep / diagonals | Root-motion speeds, sideways key picks the state (executable-analysis §11) | Shared Rapier controller at the original speeds | `VERIFIED` | WASD instead of ESDF; turned-body diagonals = feature `diagonalMoves` |
| **Movement** | Jump, gravity, air control | 78.4 ft/s², 50.45 ft/s, hold-lift, drag (§13) | Same in the shared step | `IMPLEMENTED` | Air velocity in world axes (original: body frame) |
| **Movement** | Rolls | C + direction | Same, back to back | `IMPLEMENTED` | |
| **Movement** | Ledge grab | ASM_LOW_MOUNT onto a ledge (0x004916A0) | Same | `IMPLEMENTED` | Climbing / hanging not done |
| **Camera** | 3rd-person | Classic rig (§10) | `ClassicCamera` default, "Modern" option | `VERIFIED` | |
| **Combat** | Melee combo | Five steps (0x0042CA20), side and air swings, wall jab | Same, clip-event timing | `VERIFIED` | |
| **Combat** | Shield | ±81° cone stops the whole hit; rush; use masks | Same | `VERIFIED` | No stamina in the original |
| **Combat** | Damage / resists / hit reactions | 11-type vector, armour, HP-loss rule (§8, §15) | Same | `VERIFIED` | |
| **Magic** | Spells | 11 spells (Torch Light … Holy Wrath) | All 11, server-authoritative | `IMPLEMENTED` | Some status looks are stand-ins |
| **AI** | Skeleton | Distance bands, stance, chains (Frida) | Same | `VERIFIED` | |
| **AI** | Other creatures | Per-type brains | The skeleton's, plus casters' spell choice | `IMPLEMENTED` | Unverified: no captures; aggro radius is a stand-in |
| **AI** | Creature vs creature | Guards fight hostiles; Ws5a fight | Not done | `SPECIFIED` | |
| **Inventory** | Bag, paper doll, rings | Grid bag, worn slots | MU-style window, authoritative server | `CHANGED_FOR_MULTIPLAYER` | |
| **Items** | Ground items and chests | Once per game | Once per character | `CHANGED_FOR_MULTIPLAYER` | |
| **Story** | Main quests and cutscenes | 29 sequences, 10 main quests | Same, per character | `IMPLEMENTED` | Ending after Necros not wired |
| **Story** | Side quests | 26 records, never offered (cut) | Not done; planned as feature `sideQuests` | `SPECIFIED` | Records decoded: `game-design/side-quests.md` |
| **World** | Doors, levers, movers | Mover triggers, relays | Doors, levers, Catacombs floor and bridges | `IMPLEMENTED` | Wheels, crushers, chandeliers, gears at rest |
| **World** | Save | Save files | Continuous PostgreSQL persistence | `CHANGED_FOR_MULTIPLAYER` | |
| **Graphics** | Direct3D 7 | 640×480 HAL | WebGL2 / Three.js | `CHANGED_FOR_MULTIPLAYER` | Grass, object shadows, dynamic lights optional |
| **Audio** | Miles | wav + mp3 | Web Audio | `CHANGED_FOR_MULTIPLAYER` | |
| **Video** | Intro movies | Two .bik movies | Not done; to be offered at character creation | `SPECIFIED` | |
