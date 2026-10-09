# Technical Unknowns & Active Research Register

## 1. Overview & Forensic Confidence Ratings

Every unknown item is assigned a priority and a concrete validation experiment to maintain continuous progress without blocking the core engine and vertical slice development.

---

## 2. Active Research Items

### UNK-001: Skeletal Rigging in `.mdl` Files
- **Status:** Investigating | **Priority:** High
- **Description:** Does the `.mdl` format embed joint transformations, or are skeletal hierarchies defined separately in `.ani` keyframe tracks?
- **Hypothesis:** `.mdl` defines the bind-pose mesh vertices and bone indices; `.ani` stores rotation quaternions and translation vectors per bone per frame.
- **Verification Experiment:** Write a small Python script to inspect offset tables in `drake.mdl` and correlate node counts with `anim1.ani`.
- **Vertical Slice Fallback:** Use a synthetic, rigged glTF mannequin (procedural box/cylinder armature) for Phase 5–7 vertical slice.

---

### UNK-002: Collision Capsule Representation in `.cap` Files
- **Status:** Investigating | **Priority:** Medium
- **Description:** How are collision hulls packed in `.cap` files (e.g. `Bs1a.cap`, 36 KB)?
- **Hypothesis:** Series of oriented bounding boxes (OBB) or spherical/capsule primitives with center $(X,Y,Z)$, radius $R$, and height $H$.
- **Verification Experiment:** Hex dump `Bs1a.cap`, test IEEE 754 float extraction, and check if bounding volumes align with the level mesh boundaries.
- **Vertical Slice Fallback:** Server generates AABB terrain and obstacle boxes directly from test arena coordinates.

---

### UNK-003: Exact Weapon Swing Hitbox Arc Angles
- **Status:** Low Priority | **Priority:** Low
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
