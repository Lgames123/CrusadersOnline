# Milestone 03: Asset Pipeline & Synthetic Fallbacks

## 1. Objective
Build the dual asset pipeline (ADR-003):
1. Synthetic fallback assets for clean, zero-IP testing.
2. A single TypeScript converter (`converter/`) for licensed game owners, runnable as a Node CLI and as a browser Web Worker.

## 2. Prerequisites
- Milestone 02 complete.
- pnpm workspace scaffolded (`converter/` package present).

## 3. Implementation Steps
1. Implement `client/src/assets/synthetic_factory.ts` (greybox arena, mannequin) and `pnpm gen:synthetic` to export the arena collider data shared with the server.
2. Implement pure parsers in `converter/src/formats/`: `tga.ts` first (textures), then `ctx.ts` (rules), then `mdl.ts`/`ani.ts`/`msh.ts` as reverse engineering progresses.
3. Implement `converter/src/emit/` with `@gltf-transform/core` (static meshes first, then skins and animation channels).
4. Implement the Node host (`converter/src/hosts/node.ts`, `pnpm convert`) writing to `local/generated/` with `manifest.json`.
5. Implement the browser host (`converter/src/hosts/worker.ts`) writing to OPFS, using the same parsers and emitters.
6. Parser unit tests using synthetic fixture files only.

## 4. Acceptance Criteria
- [x] Client boots with synthetic assets with zero external dependencies.
- [x] `pnpm convert` turns user textures into WebP in `local/generated/` without modifying original files.
- [ ] The browser import produces byte-identical glTF/JSON outputs to the CLI for the same inputs.
- [x] No Python step is required to build, run or convert assets.
