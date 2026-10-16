# Optional fix for the Fancy Chair's mismatched UVs

Date: 2026-10-16 · Agent: Claude Code · Commit: Optional QoL setting refits the Fancy Chair's UVs to FancyChair.tga

## Why
The user asked for an optional fix for the fancy chair, after [2026-10-16-placed-object-textures.md](2026-10-16-placed-object-textures.md) found its UVs do not fit its only texture in the original data.

## Decisions and evidence
- FCHAIR2 UV islands (connected by shared corners), measured from the .mdl:
  - Panel islands on u 0–0.69: back front, back rear, seat top (u max 0.69 / 0.66 / 0.65), and the seat edges at u 0.09–0.57, v 0.86–0.90.
  - Strip A, u 0.66–0.82: leg fronts and outsides, arms, back sides.
  - Strip B, u 0.84–1.0: leg backs and insides, arm ends.
- FancyChair.tga columns, measured by red/gold pixel counts: the cushion is x 0.125–0.875, the frame columns with gold ornaments are 0–0.12 and 0.89–1.
- The fit is done per island and keeps v. Panels that start at u 0 are stretched to the full width; the seat edges are divided by 0.67. Strip A is squeezed onto u 0.01–0.11 and strip B onto 0.89–0.99.
- Done in the client (`client/src/assets/prop_fixes.ts`, global `propFixes` like `dynamicLights`), not the converter, so the converted data stays the original's. The level loader registers each loaded model scene. Clones share geometry, so swapping the `uv` attribute on the source geometry toggles every placed chair live.

## Deviations from the original
- Setting `fixedPropUvs` ("Fix Mismatched Prop Textures", Options → Graphics), off by default.

## Gotchas
- Converted glTF UVs are interleaved (stride 32): read them with `getX/getY`, not `.array`.
- The fit's thresholds are specific to fchair2's layout; another prop needs its own fit, not a reuse.

## How to verify
- Options → Graphics → Fix Mismatched Prop Textures. Then in a Citadel interior (Ci1b…) look at the chairs under the crossed swords and round shield. On: the back frame is symmetric, the seat is a framed cushion, the legs and arms are frame with gold. Off: as the original.
