# Browser Client: Architecture, Lifecycle & Subsystems

## 1. Objective

Define the client-side architecture for CrusadersOnline, specifying module separation, rendering lifecycles, prediction and interpolation loops, and audio/UI management.

---

## 2. Modular Client Structure

The browser client is structured into decoupled, single-responsibility modules:

```
client/src/
├── main.ts                    # Bootstrap: Canvas mount & state machine init
├── engine/
│   ├── scene.ts               # Three.js Scene, Frustum, and Light setup
│   ├── classic_camera.ts      # the original's camera rig (default)
│   ├── camera.ts              # optional "Modern" over-the-shoulder camera
│   └── renderer.ts            # WebGL2 renderer lifecycle and resize handler
├── entities/
│   ├── local_player.ts        # Client player entity (Immediate input response)
│   ├── remote_player.ts       # Networked other players (Interpolated lerp/slerp)
│   ├── monster_entity.ts      # Synced enemy mob renderers & health bars
│   └── arena.ts               # Procedural greybox test arena & colliders
├── input/
│   ├── input_manager.ts       # Keyboard, mouse, pointer-lock event sampler
│   └── keybindings.ts         # User-customizable key mappings
├── network/
│   ├── ws_client.ts           # WebSocket connection, reconnection & packet queues
│   └── interpolator.ts        # Snapshot buffer & entity state interpolation
├── audio/
│   ├── audio_manager.ts       # Web Audio API spatial sound emitter
│   └── synth_sfx.ts           # Synthetic procedural sound oscillator fallbacks
├── ui/
│   ├── hud.ts                 # HTML5/CSS overlay (Health, Mana, Target, XP)
│   ├── inventory_view.ts      # Grid bag & equipment paperdoll UI
│   └── chat_box.ts            # Multiplayer text chat & combat combat logs
└── assets/
    ├── asset_loader.ts        # Unified loader (Synthetic vs User-Fed glTF)
    └── synthetic_factory.ts   # Procedural geometric meshes generator
```

---

## 3. Client Simulation & Render Lifecycle

```
[ Browser requestAnimationFrame (~60-144 Hz) ]
                     |
                     v
1. Sample Input Manager (WASD, Mouse Delta, Action Buttons)
                     |
                     v
2. Update Local Player Prediction (Apply client-side velocity)
                     |
                     v
3. Transmit Pending Inputs to WebSocket Gateway (if dirty)
                     |
                     v
4. Ingest Inbound Server Snapshots -> Push to Interpolation Buffer
                     |
                     v
5. Interpolate Remote Entities (Lerp positions between t-100ms and t-50ms)
                     |
                     v
6. Update Third-Person Chase Camera (Track local player transform)
                     |
                     v
7. Three.js Scene Render (WebGL2 draw calls)
                     |
                     v
8. Sync HTML/Canvas UI Overlay (Update HP/Mana bars, damage floaters)
```

---

## 4. Entity Interpolation Algorithm

To prevent stutter from network jitter, remote players and monsters are rendered using a **100ms Interpolation Delay Buffer**:

```typescript
export class EntityInterpolator {
  private buffer: Array<{ timestamp: number; x: number; y: number; z: number; yaw: number }> = [];

  public update(renderTime: number, currentTransform: { x: number; y: number; z: number; yaw: number }): void {
    const targetTime = renderTime - 100; // 100ms behind real-time
    // Find surrounding snapshots s0 and s1
    for (let i = 0; i < this.buffer.length - 1; i++) {
      const s0 = this.buffer[i];
      const s1 = this.buffer[i + 1];
      if (s0.timestamp <= targetTime && targetTime <= s1.timestamp) {
        const factor = (targetTime - s0.timestamp) / (s1.timestamp - s0.timestamp);
        currentTransform.x = s0.x + (s1.x - s0.x) * factor;
        currentTransform.y = s0.y + (s1.y - s0.y) * factor;
        currentTransform.z = s0.z + (s1.z - s0.z) * factor;
        currentTransform.yaw = s0.yaw + (s1.yaw - s0.yaw) * factor;
        break;
      }
    }
  }
}
```
