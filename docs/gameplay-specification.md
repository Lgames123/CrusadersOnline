# Gameplay Specification: Systems, Controls & Mechanics

## 1. Objective

Provide the complete functional specification for player controls, movement kinematics, camera behavior, combat timing, and inventory interactions for the browser-based MMORPG.

---

## 2. Input Mapping & Character Controls

### 2.1 Default Keybindings
| Action | Primary Key | Secondary Key | Input Event | Server Impact |
|---|---|---|---|---|
| **Move Forward** | `W` | `ArrowUp` | Continuous polling | Speed validated kinematic update |
| **Move Backward** | `S` | `ArrowDown` | Continuous polling | Speed validated kinematic update |
| **Strafe Left** | `A` | `ArrowLeft` | Continuous polling | Lateral kinematic update |
| **Strafe Right** | `D` | `ArrowRight` | Continuous polling | Lateral kinematic update |
| **Jump** | `Space` | - | Impulse trigger | Upward impulse $+6.5 \text{ m/s}$ |
| **Primary Attack** | `Left Click` | `Ctrl` | Discrete action | Weapon swing trigger (cooldown checked) |
| **Block / Shield** | `Right Click` | `Shift` | Continuous state | Damage reduction 70%, stamina drain |
| **Cast Spell** | `Q` | `E` | Discrete action | Mana cost & cooldown checked on server |
| **Interact / Loot** | `F` | `Enter` | Proximity trigger | Distance validation to target (<2.5m) |
| **Toggle Inventory**| `I` | `Tab` | UI Modal | Local UI toggle, server locks actions |

---

## 3. Movement Physics Specification

### 3.1 Kinematic Constants
- Standard Walk Speed: $2.5 \text{ m/s}$
- Standard Run Speed: $6.0 \text{ m/s}$
- Jump Velocity: $+6.5 \text{ m/s}$
- Gravity Acceleration: $-9.81 \text{ m/s}^2$
- Player Bounding Box: Capsule (Radius: $0.4\text{ m}$, Height: $1.85\text{ m}$)
- Ground Probe Distance: $0.1\text{ m}$ below capsule bottom
- Maximum Climbable Slope: $45^\circ$

### 3.2 Shared Movement Step (Server Authority + Client Prediction)
The client sends inputs only; the server runs this step for each applied input (ADR-005/006). The client runs the identical function for prediction.
```typescript
// shared/src/movement/step.ts
export function stepCharacter(
  ctrl: KinematicCharacterController, // Rapier, configured: maxSlopeClimbAngle 45°, autostep, snapToGround 0.1 m
  body: CharacterBody,                // capsule collider + velocity + grounded flag
  input: InputFrame,
  stats: MovementStats,               // walkSpeed 2.5, runSpeed 6.0, jumpVelocity 6.5 (server-side values)
  dt: number
): void {
  const speed = input.flags & FLAG_WALK ? stats.walkSpeed : stats.runSpeed;
  wishDirection(input, TMP_DIR);                       // from W/A/S/D flags and yaw
  body.velocity.x = TMP_DIR.x * speed;
  body.velocity.z = TMP_DIR.z * speed;
  if (body.grounded && input.flags & FLAG_JUMP) body.velocity.y = stats.jumpVelocity;
  body.velocity.y += GRAVITY * dt;                     // -9.81 m/s²

  TMP_MOVE.x = body.velocity.x * dt; TMP_MOVE.y = body.velocity.y * dt; TMP_MOVE.z = body.velocity.z * dt;
  ctrl.computeColliderMovement(body.collider, TMP_MOVE);
  const m = ctrl.computedMovement();
  body.setNextPosition(m);
  body.grounded = ctrl.computedGrounded();
  if (body.grounded && body.velocity.y < 0) body.velocity.y = 0;
}
```
There is no position validation step: positions are produced, not checked.

---

## 4. Combat Mechanics & Combo Timing

### 4.1 Melee Attack Lifecycle
Every weapon swing follows a 3-phase finite state machine:
1. **Startup (150ms):** Attack animation plays. Player cannot initiate another attack.
2. **Active (150ms):** Damage hitbox active. Server tests for enemy overlaps. Sound effect triggers.
3. **Recovery (250ms):** Weapon returns to neutral stance. Player can buffer the next combo input.

### 4.2 Combo Chain Multipliers
- Strike 1: $1.0\times$ Base Damage (Slashing)
- Strike 2: $1.25\times$ Base Damage (Upward sweep)
- Strike 3: $1.60\times$ Base Damage (Cleave, stagger effect)

---

## 5. Spells & Abilities

| Spell Name | Mana Cost | Cast Time | Cooldown | Effect |
|---|---|---|---|---|
| **Lesser Heal** | 15 MP | 1.0s | 5.0s | Restores 35 HP to caster |
| **Fireball** | 20 MP | 0.8s | 3.0s | Launches 15 m/s projectile dealing 40 Fire damage in 3m AoE |
| **Lightning Bolt**| 30 MP | 0.4s | 6.0s | Instant raycast dealing 55 Shock damage to target |
