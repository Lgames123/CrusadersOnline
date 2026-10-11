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

| Subsystem | Mechanic | Original 1999 Behavior | MMORPG Reconstruction | Status | Notes |
|---|---|---|---|---|---|
| **Movement** | ESDF (moved to WASD) / Strafe | Root-motion driven: run 15.6 ft/s, retreat 3.9, sidestep 10.3, careful walk 5.2 / 3.8 (executable-analysis.md §11) | Shared Rapier controller with the per-direction original speeds (averaged per loop) | `IMPLEMENTED` | Jump impulse and speed multiplier pending (UNK-012) |
| **Movement** | Jump Impulse | Upward arc with gravity | Fixed $+6.5 \text{ m/s}$ impulse at 20Hz | `SPECIFIED` | Parity with Drake height |
| **Movement** | Ledge Clamber | Drake pulls up on ledges | Deferred to Phase 8 | `SPECIFIED` | Complex animation blend |
| **Camera** | 3rd-Person Chase | Rig 4 ft + 2.2 ft up, 7 ft back, aim 8 ft ahead, distance-proportional smoothing, 79.6° horizontal FOV (executable-analysis.md §10) | `ClassicCamera` (default) + optional `ChaseCamera` "Modern" (player setting) | `IMPLEMENTED` | Turn/look rates provisional (UNK-011) |
| **Combat** | Sword Slash 1 | Right-to-left sweep (150ms active) | Server-authoritative capsule sweep | `SPECIFIED` | Standardized hitboxes |
| **Combat** | 3-Hit Combo | Timing window chains 3 attacks | Server buffers attack sequence index | `SPECIFIED` | Multipliers 1.0, 1.25, 1.6 |
| **Combat** | Shield Block | Blocks forward arc, drains stamina | Reduces incoming damage by 70% | `SPECIFIED` | Shield durability added |
| **Magic** | Fireball Spell | Straight projectile with explosion | Server projectile with spatial AoE | `SPECIFIED` | Mana cost enforced |
| **Magic** | Lesser Heal | Restores health over cast time | Cast bar + server heal packet | `SPECIFIED` | Interruptible on hit |
| **AI** | Skeleton Patrol | Waypoint walk within home anchor | Server spatial hash patrol routine | `SPECIFIED` | Leash distance 25m |
| **AI** | Enemy Aggro | Line-of-sight visual detection | 12m detection radius + threat table | `CHANGED_FOR_MULTIPLAYER` | Threat divided by party |
| **Inventory** | Item Slots | Grid bag with equipped paperdoll | PostgreSQL transactional inventory | `CHANGED_FOR_MULTIPLAYER` | Anti-duplication locks |
| **Progression** | Leveling & XP | Kill XP advances Drake stats | Server XP curve advances character | `CHANGED_FOR_MULTIPLAYER` | Synced to database |
| **World** | Checkpoint Save | Shrines save local file to disk | Real-time PostgreSQL WAL persistence | `CHANGED_FOR_MULTIPLAYER` | No offline save files |
| **Graphics** | Direct3D 7 | 640x480 / 800x600 Direct3D HAL | WebGL2 / Three.js 1080p+ 60FPS | `CHANGED_FOR_MULTIPLAYER` | Modern browser canvas |
| **Audio** | Miles Sound System | 2D/3D wav effects + mp3 music | Web Audio API + Howler spatial cues | `CHANGED_FOR_MULTIPLAYER` | Pure web standards |
