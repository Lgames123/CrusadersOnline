# Knock-backs and shoves no longer bury the body in the level

Date: 2026-10-20 · Agent: Claude Code · Commit: A fire ball's knock-back no longer sinks Drake into slopes and drops him through the map

## Why
The user reported clipping through the map when hit, last seen from a Dark Mage's (green) fire ball in Ca3a/Ca3b. The HAR had no WebSocket frames, only the level fetches.

## Decisions and evidence
- **Cause:** `WorldZone.moveBy` made one controller move, kept the **x/z** and dropped the height the controller climbed (`y: p.y`). Pushed up a slope or a step, the capsule ended up inside the geometry. From inside a trimesh, Rapier lets it fall or pass through.
- **Measured** with one 15 ft move (`SPELL_RULES.explosionKnock`) from every start and creature spot, 16 directions, in 6 acts: 438 of 3,872 ended buried. One in Ws9a then fell 107 m out of the level. With the fix: 0.
- **Fix:** shared `pushCharacter(mw, c, x, z)`. It moves in 0.25 m controller steps and applies each step's height, keeping the motion state. `moveBy` uses it, so fire ball and holy wrath knock-backs, blow shoves (`shove`) and creature separation (`separate`) all go through it.
- Ruled out first:
  - The shared step's hit reactions: up to 3× clip rate against walls, ~3,400 trials, no crossing.
  - A fast player in a real zone under attack: no crossing.
  - 1 mm snapshot positions.
- The "high movement speed" part wasn't needed to reproduce this.

## Not done / not decoded
- Not seen live. A client-side snap for corrections whose smoothing line crosses a wall was tried, then reverted: it wasn't the cause.
- The original applies the knock as a one-frame physics impulse (0x0044D290). Ours is still an instant move.

## How to verify
- `pnpm test:unit`, movement: "pushes a character up a slope with the height the move climbs".
