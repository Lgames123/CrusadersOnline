# Milestone 05: Browser 3D Rendering Prototype

## 1. Objective
Scaffold the browser client running Vite and Three.js, rendering a controllable player in a synthetic test arena with a third-person chase camera. Movement and collision use the shared Rapier movement step from M04 (offline, no server yet).

## 2. Prerequisites
- Milestone 04 complete.
- Vite and Three.js installed in `client/`.

## 3. Implementation Steps
1. Create `client/index.html` and mount the WebGL2 canvas (`WebGLRenderer`).
2. Implement `client/src/engine/camera.ts` with orbital mouse look and pitch clamps.
3. Implement `client/src/input/input_manager.ts` producing input frames (flags, yaw, pitch) at a fixed client tick.
4. Build the synthetic greybox arena (floor, ramps, perimeter walls, pillars) and its Rapier colliders from the same data the server will load.
5. Drive the local player with `stepCharacter()` from `shared/src/movement/`.

## 4. Acceptance Criteria
- [ ] Client runs at 60 FPS in browser at `http://localhost:3000`.
- [x] Player avatar moves using WASD, climbs ramps and collides with arena boundaries via the shared controller.
- [ ] Third-person camera tracks player without clipping through obstacles.
