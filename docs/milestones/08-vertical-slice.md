# Milestone 08: Minimum Playable Vertical Slice (Primary Architectural Gate)

## 1. Objective

Validate the entire end-to-end architecture (Browser Client, Three.js WebGL2, WebSocket Network Gateway, 20Hz Authoritative Server Simulation, and PostgreSQL Persistence) in an integrated, fully playable test arena without requiring any copyrighted assets.

```
+-----------------------------------------------------------------------------------+
|                     VERTICAL SLICE MULTI-CLIENT VALIDATION                        |
+-----------------------------------------------------------------------------------+
|   [ Browser Tab 1: Player A ]             [ Browser Tab 2: Player B ]             |
|          |                                         |                              |
|          +--------------------+  +-----------------+                              |
|                               |  |                                                |
|                               v  v                                                |
|            [ Authoritative Game Server (20Hz Tick) ]                              |
|             - Synchronized Player A & B Avatars (Interpolation)                   |
|             - Server-Simulated Skeleton Mob (Aggro + Health)                      |
|             - Authoritative Melee Damage Resolution                               |
|                               |                                                   |
|                               v                                                   |
|             [ PostgreSQL 18 Persistence Engine ]                                  |
|             - Characters, Gold, XP Saved & Reloaded                               |
+-----------------------------------------------------------------------------------+
```

---

## 2. Prerequisites
1. Milestones 00 through 07 complete.
2. PostgreSQL running locally or in Docker.
3. Clean checkout building without errors.
4. Synthetic assets generated and available in `client/public/assets/`.

---

## 3. The 14 Acceptance Criteria & Verification Procedures

### Criterion 1: Clean Checkout Build
- **Test:** Run `pnpm build` from the workspace root.
- **Expected Result:** TypeScript compilation succeeds across `shared`, `converter`, `server`, and `client`. Vite bundles client assets into `client/dist/`.

### Criterion 2: Dependency Installation from Docs
- **Test:** Run `pnpm install --frozen-lockfile` on a clean checkout.
- **Expected Result:** All npm dependencies resolve without peer-dependency conflicts.

### Criterion 3: Database Schema Initialization
- **Test:** Run `pnpm db:migrate`.
- **Expected Result:** PostgreSQL tables `accounts`, `sessions`, `characters`, and `inventory_items` are created with constraints.

### Criterion 4: Authoritative Server Startup
- **Test:** Run `pnpm start:server`.
- **Expected Result:** Terminal outputs `Server listening on ws://localhost:8080` and `Simulation ticking at 20 Hz`.

### Criterion 5: Browser Client Startup
- **Test:** Open `http://localhost:3000` in Google Chrome / Edge.
- **Expected Result:** Canvas initializes at 60 FPS, displaying greybox arena and HUD.

### Criterion 6: Controllable Player Locomotion
- **Test:** Press WASD keys and Space bar.
- **Expected Result:** Player avatar runs forward, backward, strafes, and jumps with realistic gravity arcs.

### Criterion 7: Collision with Test Geometry
- **Test:** Run character into perimeter arena walls and central pillars.
- **Expected Result:** Player stops cleanly, walks up ramps, and never clips or falls through the ground (shared Rapier controller, identical on client and server).

### Criterion 8: Two Independent Browser Clients Connect
- **Test:** Open a second browser tab (or Incognito window) at `http://localhost:3000`.
- **Expected Result:** Server reports two active connected player sessions in logs.

### Criterion 9: Multi-Client Movement Synchronization
- **Test:** Move Player 1 in Tab 1; observe Tab 2.
- **Expected Result:** Player 2 sees Player 1 avatar moving smoothly across the arena with <100ms interpolation lag.

### Criterion 10: Server-Authoritative Movement Validation
- **Test:** From the DevTools console, (a) multiply the local run speed by 5, and (b) send input packets at 10× the normal rate.
- **Expected Result:** The server-side character moves at normal speed in both cases (inputs only, at most one per tick); the cheating client is pulled back by reconciliation. Other clients never see the accelerated movement.

> **Status 2026-10-09:** criteria 1–13 are implemented and covered by automated tests (unit, integration on PGlite + PostgreSQL) and a browser check; criterion 14's Playwright two-tab suite is still to be written.

### Criterion 11: Representative Skeleton Enemy & Aggro
- **Test:** Walk player avatar to within 10 meters of the central Skeleton mob.
- **Expected Result:** Skeleton transitions from IDLE to CHASE, navigating toward the player.

### Criterion 12: Authoritative Melee Combat & Damage Event
- **Test:** Left-click to swing weapon at Skeleton.
- **Expected Result:** Server validates weapon sweep, calculates damage, decrements Skeleton HP, and displays floating damage text on both clients.

### Criterion 13: Character State Survival Across Restart
- **Test:** Gain XP and defeat Skeleton. Shut down server with `Ctrl+C`. Restart server and log back in.
- **Expected Result:** Character displays updated XP, level, and inventory acquired from the encounter.

### Criterion 14: Automated Test Suite Passes
- **Test:** Run `pnpm test`.
- **Expected Result:** 100% of unit, integration, and Playwright multi-client tests pass.
