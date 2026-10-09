# Runtime Observations & Gameplay Mechanics Reconstruction

## 1. Objective

Document observable gameplay behavior from original playthroughs, captures, and runtime inspection of *Crusaders of Might and Magic* to ground the browser MMORPG engine reconstruction in empirical game feel.

---

## 2. Character Movement & Kinematics

### 2.1 Coordinate System & Units
- **Handedness:** Standard DirectX Left-Handed or OpenGL Right-Handed (Z forward / Y up in WebGL/Three.js).
- **Scale:** 1 unit corresponds roughly to 1 meter in human character scale (Drake model height is ~1.85 units).
- **Gravity Acceleration:** Estimated at $-9.81 \text{ m/s}^2$ with a terminal fall velocity clamped at $-25.0 \text{ m/s}$.

### 2.2 Locomotion States
1. **Idle:** Drake stands in combat-ready posture with slight breathing loop.
2. **Walk:** Forward movement at approximately $2.5 \text{ m/s}$.
3. **Run:** Forward sprint at approximately $6.0 \text{ m/s}$.
4. **Strafe Left / Right:** Lateral sidestepping at approximately $3.5 \text{ m/s}$.
5. **Backpedal:** Backward retreat at approximately $2.0 \text{ m/s}$.
6. **Jump:** Upward impulse of $+6.5 \text{ m/s}$, allowing Drake to clear low obstacles and chasms.
7. **Ledge Grab / Clamber:** Triggered when jumping toward an obstacle ledge within reach of Drake's arms (Phase 8 enhancement).

---

## 3. Camera Mechanics

- **Camera Type:** Third-person trailing orbital chase camera.
- **Default Distance:** 3.5 meters behind player character, elevated 1.8 meters above ground.
- **Look Pitch Angle:** Clamped between $-60^\circ$ (looking up from behind) and $+75^\circ$ (looking almost straight down).
- **Camera Collision:** Spherical raycast collision check preventing the camera frustum from clipping inside world geometry.
- **Target Lock:** Optional soft auto-facing toward targeted enemies during melee lock-on.

---

## 4. Combat Timing & Weapon Chains

### 4.1 Melee Weapon Timing Breakdown
- **Wind-up Phase (Anticipation):** 0.15s – 0.20s (weapon draws back; non-canceling).
- **Active Hitbox Phase (Damage Window):** 0.20s – 0.35s (weapon sweeping in arc; server calculates capsule overlap).
- **Recovery Phase (Cooldown):** 0.25s – 0.40s (character resets to guard posture; can be chained into combo).

### 4.2 Three-Hit Combo Chain
- Strike 1: Right-to-left horizontal slash (Base damage $\times 1.0$).
- Strike 2: Left-to-right diagonal upward slash (Base damage $\times 1.15$).
- Strike 3: Overhead vertical execution cleave (Base damage $\times 1.50$, knockdown chance).

---

## 5. Enemy AI Behavior Archetypes

### Skeleton Warrior (`skel1.mdl`):
- **Aggro Radius:** 12.0 meters line-of-sight.
- **Patrol:** Navigates between waypoint nodes or wanders within a 6.0 meter home radius.
- **Combat Logic:** Advances to within 2.0 meters, performs a 2-strike slash sequence, then steps back 1.5 meters into defensive guard.
- **Flinch Threshold:** Stagger animation plays if receiving $> 15\%$ maximum HP in a single strike.

---

## 6. Implementation Guidance for Server & Client

1. **Client Responsibilities:**
   - Play immediate responsive attack animation upon user click.
   - Render weapon trail particle effects.
   - Send `MSG_PLAYER_ATTACK` packet with attack sequence index.
2. **Server Responsibilities:**
   - Verify weapon cooldown timestamp.
   - Calculate weapon sweep capsule against all registered enemy AABBs in the spatial hash.
   - Broadcast authoritative hit confirmation `MSG_ENTITY_DAMAGE` to all nearby clients.
