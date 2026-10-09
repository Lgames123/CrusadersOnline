# Milestone 04: Shared Engine Foundation, Movement & Protocol

## 1. Objective
Implement in `shared/` everything that must behave identically on client and server: math, the Rapier-based movement step (ADR-005/006), binary hot-path codecs and control-message schemas (ADR-004), and the spatial hash.

## 2. Prerequisites
- Milestone 01 complete.
- pnpm workspace active.

## 3. Implementation Steps
1. Implement `shared/src/math/` (vector3, quaternion, quantization helpers).
2. Implement `shared/src/movement/` — `stepCharacter(world, character, input, dt)` on top of Rapier's `KinematicCharacterController` (capsule, slopes, step-up, gravity, jump).
3. Implement binary codecs in `shared/src/protocol/binary/` for `CS_PLAYER_INPUT` and `SC_WORLD_SNAPSHOT` (quantization + delta vs baseline), writing into preallocated objects.
4. Define control-message opcodes and Zod schemas in `shared/src/protocol/control/`.
5. Implement the integer-keyed spatial hash grid in `shared/src/spatial_hash.ts`.
6. Vitest unit tests: codec round-trip and fuzzing, movement determinism on Node (same input sequence → same position).

## 4. Acceptance Criteria
- [x] Codec round-trips are lossless within quantization error; random byte buffers never throw (decoder returns `null`).
- [x] Movement step yields identical results across 10,000 replayed ticks on Node.
- [x] Zod schemas reject malformed control payloads.
