# Testing Strategy: Unit, Integration, E2E & Load Testing

## 1. Objective & Multi-Tier Testing Pyramid

CrusadersOnline implements an automated testing strategy guaranteeing deterministic physics, protocol integrity, and multi-client synchronization across all development phases.

```
                  / \
                 /   \
                / E2E \       Playwright Multi-Tab Browser Tests (2 Clients + Server)
               /-------\
              / Integr. \     Server Tick & WebSocket Packet Roundtrip Tests (Vitest)
             /-----------\
            / Unit Tests  \   Math, Codecs, Movement, Zod, Parsers (Vitest)   
           /---------------\
```

---

## 2. Test Suites

### 2.1 Unit Tests (`tests/unit/`)
- Fast, headless, zero external dependencies.
- Coverage:
  - 3D Vector & Raycast math.
  - Shared movement step (Rapier controller): determinism across replayed input sequences, slopes, steps, walls.
  - Binary codecs: round-trip within quantization error, fuzzing with random buffers (decoder never throws).
  - Zod control-message schemas (valid vs malformed payloads).
  - Combat formula damage calculations.
  - Converter parsers (`tga`, `ctx`, `mdl`, ...) against synthetic fixture files.

### 2.2 Integration Tests (`tests/integration/`)
- Launches an in-process WebSocket server and a real PostgreSQL instance (Docker / Testcontainers) — no database mocks for persistence logic.
- Coverage:
  - Login, session cookie, single-use WS ticket redemption, ticket reuse/expiry rejection.
  - Player spawn and spatial interest subscription.
  - Forged and accelerated input streams never exceed controller speed (ADR-006).
  - Inventory item equip and swap transactions, including concurrent duplicate attempts.

### 2.3 End-to-End Tests (`tests/e2e/`)
- Uses Playwright to launch two Chromium browser tabs.
- Coverage:
  - Tab 1 connects as Player 1; Tab 2 connects as Player 2.
  - Player 1 moves forward; Tab 2 observes Player 1 avatar moving smoothly.
  - Player 1 attacks an enemy mob; Tab 2 observes combat damage number.
  - Player 1 disconnects; Tab 2 observes despawn.
- Implemented in `tests/e2e/two_clients.spec.ts` (two browser contexts as guests). Input goes through the client's real keyboard/mouse handlers; the dev-only `window.__co` hook stands in for pointer lock, which headless browsers do not grant.

---

## 3. Test Execution Commands

```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
# Run Unit Tests
pnpm test:unit

# Run Integration Tests
pnpm test:integration

# Run Playwright E2E Tests (starts its own server on 8091 and client on 3001;
# uses the installed Edge by default, PW_CHANNEL=chrome for Chrome, HEADED=1 to watch)
pnpm test:e2e
```
