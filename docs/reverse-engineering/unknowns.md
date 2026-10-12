# Technical Unknowns & Active Research Register

## 1. Overview & Forensic Confidence Ratings

Every unknown item is assigned a priority and a concrete validation experiment to maintain continuous progress without blocking the core engine and vertical slice development.

---

## 2. Active Research Items

### UNK-001: Skeletal Rigging in `.mdl` Files
- **Status:** RESOLVED (2026-10-09) — see asset-format-discovery.md §3. `.mdl` stores the bind-pose hierarchy (depth-first nodes with local quaternion + translation, subtree sizes) and rigid per-node vertices; no blend weights. `.ani` stores the per-frame bone transforms.
- **Original priority:** High
- **Description:** Does the `.mdl` format embed joint transformations, or are skeletal hierarchies defined separately in `.ani` keyframe tracks?
- **Hypothesis:** `.mdl` defines the bind-pose mesh vertices and bone indices; `.ani` stores rotation quaternions and translation vectors per bone per frame.
- **Verification Experiment:** Write a small Python script to inspect offset tables in `drake.mdl` and correlate node counts with `anim1.ani`.
- **Vertical Slice Fallback:** Use a synthetic, rigged glTF mannequin (procedural box/cylinder armature) for Phase 5–7 vertical slice.

---

### UNK-002: Collision Capsule Representation in `.cap` Files
- **Status:** Hypothesis rejected (2026-10-09) — `.cap` files are DCL-compressed level object placements (asset-format-discovery.md §6). Level collision must come from the `.msh` geometry.
- **Original priority:** Medium
- **Description:** How are collision hulls packed in `.cap` files (e.g. `Bs1a.cap`, 36 KB)?
- **Hypothesis:** Series of oriented bounding boxes (OBB) or spherical/capsule primitives with center $(X,Y,Z)$, radius $R$, and height $H$.
- **Verification Experiment:** Hex dump `Bs1a.cap`, test IEEE 754 float extraction, and check if bounding volumes align with the level mesh boundaries.
- **Vertical Slice Fallback:** Server generates AABB terrain and obstacle boxes directly from test arena coordinates.

---

### UNK-003: Exact Weapon Swing Hitbox Arc Angles
- **Status:** Resolved by measurement (2026-10-12): player reach 6–7.6 ft, arc ±40–45°; skeleton hits up to 5.25 ft (executable-analysis.md §14.1). The hit-test routine itself (sphere vs. weapon line?) is not located. | **Priority:** Low
- **Description:** What was the precise angular sweep of Drake's horizontal slash ($90^\circ$, $120^\circ$, or $180^\circ$)?
- **Hypothesis:** A $120^\circ$ forward cone with radius $2.2$ meters matches visual playthrough footage.
- **Verification Experiment:** Record frame-by-frame hitbox intersection against multiple stationary targets.
- **Vertical Slice Implementation:** Standardize on $110^\circ$ forward arc with $2.0$ meter reach.

---

### UNK-004: Dialogue and Quest Script Bytecode (`script/*.bin`)
- **Status:** Deferred | **Priority:** Low
- **Description:** Are `.bin` files compiled bytecode or simple sequential string ID triggers?
- **Verification Experiment:** Strings inspection shows text dialogue IDs that correlate directly with `script/messages.ctx`.
- **Vertical Slice Fallback:** Vertical slice focuses on combat and multiplayer movement; questing is scheduled for Phase 8.

---

### UNK-005: `.ani` Block Layout
- **Status:** RESOLVED (2026-10-09) — see asset-format-discovery.md §4 (from the engine's evaluator; 1,499/1,501 pairs verified).
- **Original priority:** High
- **Description:** Exact meaning of the 64-byte per-bone blocks (translation vs. rotation fields, padding), the role of the event-frame list, and how bones are matched to model nodes (by order or by name).
- **Verification Experiment:** For a model and its animation (from `script/models.ctx`), check that block count = frames × bones; apply frame 0 to the skeleton and compare with the bind pose.

### UNK-006: Node Flags and Transform-Dummy Layout in `.mdl`
- **Status:** Partially resolved (2026-10-12) — `DMY XFRM` records are `u32 node` + rotation quaternion **(w, x, y, z)** + translation (w first, unlike the nodes' x, y, z, w: read as x-first, every held sword pointed down), relative to that bone (the four leading floats are unit quaternions in every character checked). Characters carry `DMY XFRM WPN RIGHT` (on `Bip01 R Finger0`, the weapon) and `DMY XFRM WPN LEFT` (on `Bip01 L Forearm`, the shield). Held items are mounted by their own node frame (their header bounds are node-local). Rendering Drake's and the skeletons' Long Sword and Wooden Shield this way puts them in hand and on the forearm. Still open: the node `u16` flag bits (0, 2, 3, 5, 7, 8).
- **Priority:** Low
- **Description:** Bits of the node `u16` flags (0, 2, 3, 5, 7, 8) and the exact rotation/translation split of the 32-byte `DMY XFRM` records.


### UNK-007: World Unit and Physics Constants
- **Status:** Partially resolved (2026-10-09) — locomotion and jumps are animation-driven (executable-analysis.md §7.1), so there is no player gravity/jump constant to recover; fallback creature speed is 15 units/s. Still open: unit of `dt` at the caller (30 vs 33.3 frames/s) and units → metres.
- **Original priority:** High
- **Description:** Character heights (Drake 6.58 units) suggest feet. Confirm from the movement/jump code (gravity, jump impulse, step height) and replace the vertical-slice constants with the original values.


### UNK-008: Damage Application and Resists
- **Status:** Mostly resolved (2026-10-09) — executable-analysis.md §8. Remaining: data source of flat absorption, attack-mode selection (which attacks use ×1.25), creature resist tables.
- **Original priority:** High
- **Description:** How the target applies `DR` resist multipliers per damage type and difficulty, armour, blocking and the combo/attack-type modifiers. The code lives in regions Ghidra has not turned into functions yet.
- **Next step:** re-run Ghidra auto-analysis with the aggressive function finder, then follow readers of the resist table filled by `Rules_LoadDefaultCtx`.

### UNK-010: `Ws_a.msh` (header flags 2) and lightmap gain
- **Status:** Partly resolved (2026-10-12) | **Priority:** Low
- **Description:** `Ws_a.msh` sets header flag 2, which inserts an 8216-byte (0x2018) table at 0x112, before the usual `[u32 size][DCL]` lightmap block (16-bit values in ramps 0..27/31, purpose unknown — possibly a colour or fog table); the rest of the file is like the other meshes and converts. Still open: that table's meaning, and the modulation factor between texture and lightmap (×2 assumed).

### UNK-011: Keyboard Turn Rate, Look Rate and Pitch Limits
- **Status:** Resolved by measurement (2026-10-11): the body follows the view heading at ≤ 270°/s (80°/s airborne), pitch clamp ±90° (executable-analysis.md §13). Arrow turn 200°/s, numpad look 150°/s and pitch ±80° measured in the running game; only the code location is missing. | **Priority:** Low
- **Description:** The camera rig is recovered (executable-analysis.md §10), but the keyboard rotation speed (arrows), the numpad look speed, the mouse look sensitivity and the pitch limits are not. The client uses provisional values (2.5 rad/s turn, 1.2 rad/s look, pitch −1.2..0.6 rad). Rotation may be animation-driven (`ASM_TURN_L/R`).
- **Verification Experiment:** Find the player input handler that writes the character's heading and pitch (callers of the orientation component setters used by the camera rig) and read its constants.

### UNK-012: Jump Impulse and Clip Playback Rate
- **Status:** Resolved (2026-10-11): jump impulse, gravity, drag and air control (executable-analysis.md §13); jump kinds are ASM state ids and clips play at 1000/30 frames per second (§14). | **Priority:** Medium
- **Description:** Locomotion speeds come from root motion (executable-analysis.md §11), but the jump clips barely move the root, so the jump's vertical speed and the directional jump/flip distances are not known (the slice keeps 6.5 m/s). Also, `Char_RootMotionVelocity` advances clips by `dt × 1000 × (1/30)`: if `dt` is in seconds, clips would play at 33.3 frames/s and every speed would be 11% higher than the 30 fps figures used. The unit of `dt` at the caller is unconfirmed.
- **Verification Experiment:** Follow the `JUMP LEAVEGROUND` animation event handler to the code that sets the character's vertical velocity; trace the time argument of `Char_RootMotionVelocity` back to the frame timer (`0x004FDFA4`, integer ms).

### UNK-009: Creature HP and XP Values
- **Status:** Resolved (2026-10-09) — per-placement HP, XP, disposition and resists in the `.cap` object records (asset-format-discovery.md §6.2).
- **Original priority:** Medium
- **Description:** Creature HP and experience value are not in the creature template table (executable-analysis.md §9). Default HP is 20; actual values must come from per-placement records in the level `.msh` files.
- **Verification Experiment:** Locate the `.msh` object-placement section (NUM_MESH_OBJ_TYPES check), find records carrying a creature type id (113–162) and correlate their numeric fields with in-game HP.
