# Stone Skin keeps the body lit

Date: 2026-10-19 · Agent: Claude Code · Commit: Stone Skin patches the body's material in place: the drake keeps taking the level's light after it ends

## Why
After Stone Skin the drake stayed dark wherever it stood: no level light, no dynamic lights.

## Decisions and evidence
- `setStoneSkin` cloned each body mesh's material and replaced its `onBeforeCompile`. By then the material is the unlit MeshBasic copy ModelLighting tints every frame (`Tracked.materials`) and `dynamicLights.enhance` hooks; the clone was in neither, so its colour froze at the light it had when the spell landed and the dynamic lights shader was dropped.
- Now the stone mix is chained onto the material in place (previous `onBeforeCompile` and cache key kept, `userData.stoneSkin` guards a second patch), as prop_shadows.ts does.

## Gotchas
- Relies on the avatar already being tracked (`lighting.track` swaps in per-object unlit copies). An untracked avatar's materials come from `cloneSkinned` and may be shared between instances of the same model: patching them would stone every one.

## How to verify
- spells-server/spells-client, cast Stone Skin, let it end, walk between lit and dark spots (and near a torch with enhanced lighting): the drake's shading follows. Not checked in the running game here (pane hidden); client typecheck passes.
