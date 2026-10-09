# Risk Register: CrusadersOnline Reconstruction

## 1. Risk Matrix & Severity Definitions

Risks are scored on **Probability (1-5)** and **Impact (1-5)**, yielding a composite Risk Score from 1 to 25.
- **Red (15-25):** Critical risk threatening project viability or legal compliance. Requires immediate active mitigation.
- **Yellow (8-14):** Moderate risk affecting timeline, fidelity, or architectural rework. Requires proactive contingency design.
- **Green (1-7):** Low risk managed through routine engineering best practices.

---

## 2. Identified Risks & Mitigations

### 2.1 Legal & Intellectual Property Risks

#### RSK-001: Accidental Leakage of Proprietary 3DO Game Assets into Git
- **Category:** Legal / Copyright Compliance
- **Probability:** 2 | **Impact:** 5 | **Score: 10 (Yellow)**
- **Description:** Committing original `.mdl`, `.ctx`, `.mp3`, `.wav`, or `.exe` files into a public repository could trigger DMCA takedown requests or copyright liability.
- **Mitigation Strategy:**
  1. Multi-layered `.gitignore` explicitly blocking all game extensions and the `local/` tree.
  2. Automated pre-commit hook scanning file extensions and MIME types.
  3. Continuous testing using pure synthetic placeholder assets (cubes, cylinders) by default.
  4. Explicit instruction that users process their own local files offline.
- **Residual Risk:** Negligible.

#### RSK-002: Public Web Client Distributing Copyrighted Materials
- **Category:** Legal / Distribution
- **Probability:** 2 | **Impact:** 5 | **Score: 10 (Yellow)**
- **Description:** If a deployed web client hosts converted 3DO textures or audio on a public CDN/S3 bucket, third-party visitors without game licenses would download proprietary material.
- **Mitigation Strategy:**
  1. The deployed public client ships strictly with synthetic CC0/procedural assets.
  2. Original asset textures and audio are loaded client-side via the browser's File System Access API or local IndexedDB imported by the user directly.
- **Residual Risk:** Low.

---

### 2.2 Reverse Engineering & Binary Format Risks

#### RSK-003: Undocumented 3D Model Format (`.mdl`) Complexity
- **Category:** Technical Uncertainty
- **Probability:** 4 | **Impact:** 3 | **Score: 12 (Yellow)**
- **Description:** 3DO's proprietary `.mdl` files may contain non-standard bone weighting, proprietary vertex compression, or embedded animation tracks that resist clean reverse engineering.
- **Mitigation Strategy:**
  1. Architecture decoupled from original formats: rendering engine consumes standard glTF 2.0.
  2. Implement synthetic procedural models (rigged mannequin) for all Phase 5–8 milestones.
  3. Incremental reverse engineering: extract raw vertex buffers first, normals second, bone weights third.
- **Residual Risk:** Moderate (may require manual Blender cleanup for certain complex monster meshes).

#### RSK-004: Undocumented Texture Container Format (`.ctx` / `.czx`)
- **Category:** Format Compatibility
- **Probability:** 3 | **Impact:** 3 | **Score: 9 (Yellow)**
- **Description:** Textures may use proprietary palette indices, run-length encoding (RLE), or LZW compression.
- **Mitigation Strategy:**
  1. Scan strings in `gfx_d3d.dll` and `crusaders.exe` to inspect decompression symbols.
  2. Notice presence of `uz.dll` (Unzip library) in root directory, suggesting standard zlib/zip compression wrappers.
  3. Probe headers with throwaway Python scripts in `tools/`; implement the production parser in `converter/src/formats/` (TypeScript).
- **Residual Risk:** Low.

---

### 2.3 Networking, Simulation & Security Risks

#### RSK-005: Client-Side Movement Cheating & Teleportation
- **Category:** Security / Game Integrity
- **Probability:** 4 | **Impact:** 4 | **Score: 16 (Red)**
- **Description:** In a browser game, malicious players can easily modify client JavaScript variables to grant infinite speed, flight, or instant teleportation.
- **Mitigation Strategy:**
  1. **Input-Only Protocol (ADR-006):** Clients send movement inputs, never positions. The server simulates every character with the shared Rapier controller.
  2. At most one input applied per player per tick; excess input frames are dropped.
  3. Collision against world geometry is computed server-side by the same controller.
- **Residual Risk:** Very low (remaining vector: automation/bots, handled separately).

#### RSK-006: Server Simulation Tick Stutter under High Concurrency
- **Category:** Performance / Scalability
- **Probability:** 3 | **Impact:** 4 | **Score: 12 (Yellow)**
- **Description:** Simulating 20Hz physics and interest management for hundreds of players in Node.js could encounter V8 garbage-collection spikes or CPU bottlenecks.
- **Mitigation Strategy:**
  1. Spatial hash grid partitioning limits entity comparisons to local 32x32m grid cells.
  2. Zero-allocation design: reuse object vectors in the tick loop.
  3. One `worker_thread` per zone from the start (ADR-009); monotonic fixed-step clock; binary hot-path codecs (no per-packet JSON/Zod).
  4. Core simulation can be rewritten in Rust/WASM if profiling dictates.
- **Residual Risk:** Low.

#### RSK-007: Inventory Duplication via Network Replay Attacks
- **Category:** Security / Persistence
- **Probability:** 3 | **Impact:** 4 | **Score: 12 (Yellow)**
- **Description:** Dropping, trading, or banking items while sending parallel packet floods could cause race conditions and duplicate valuable gear.
- **Mitigation Strategy:**
  1. All inventory mutations (equip, unequip, drop, loot) are processed through PostgreSQL ACID transactions with row-level locks (`SELECT ... FOR UPDATE`).
  2. Client action sequences utilize monotonically increasing nonces.
- **Residual Risk:** Low.

---

#### RSK-009: Client Prediction Desync (Client vs Server Movement)
- **Category:** Gameplay Feel / Networking
- **Probability:** 3 | **Impact:** 3 | **Score: 9 (Yellow)**
- **Description:** If the client and server movement code differ, players see constant rubber-banding.
- **Mitigation Strategy:**
  1. Single shared `stepCharacter()` (Rapier) used by both sides; same collider data on both sides.
  2. Reconciliation by replaying unacknowledged inputs; small errors smoothed, large errors snapped.
  3. E2E test asserting convergence between predicted and authoritative positions.
- **Residual Risk:** Low.

#### RSK-010: Converter Fragmentation (Two Pipelines)
- **Category:** Maintainability
- **Probability:** 2 | **Impact:** 3 | **Score: 6 (Green)**
- **Description:** Separate CLI and browser converters would drift and double the reverse-engineering effort.
- **Mitigation Strategy:** One TypeScript converter package with pure parsers and two thin hosts (ADR-003); test that both hosts produce identical outputs.
- **Residual Risk:** Low.

---

### 2.4 Browser Rendering & Client Platform Risks

#### RSK-008: Variable Browser Performance on Integrated GPUs
- **Category:** Client Performance
- **Probability:** 3 | **Impact:** 3 | **Score: 9 (Yellow)**
- **Description:** Low-end laptops or mobile browsers may struggle to maintain 60 FPS if draw calls or shader complexity escalate.
- **Mitigation Strategy:**
  1. Maintain a strict performance budget (under 100 draw calls, under 50,000 polygons per scene).
  2. Use WebGL2 instanced rendering for repeated environment props (torches, pillars, trees).
  3. Provide graphics scalability toggles (resolution scale, shadow quality, particle density).
- **Residual Risk:** Low.

---

### 2.5 Legal: Naming & Trademarks

#### RSK-011: Use of the Original Game's Title or Franchise Marks
- **Category:** Legal / Trademark
- **Probability:** 3 | **Impact:** 5 | **Score: 15 (Red)**
- **Description:** "Crusaders of Might and Magic" and "Might and Magic" are third-party trademarks (currently Ubisoft). A public MMO using them as its name or branding is a larger exposure than the assets themselves, which the zero-IP policy already covers.
- **Mitigation Strategy:**
  1. The project name and all branding are **CrusadersOnline** only (ADR-011).
  2. The original title appears only nominatively (describing compatibility with the user's own installation).
  3. Security checklist item verifying UI strings, page titles and package metadata before every public release.
- **Residual Risk:** Low.
