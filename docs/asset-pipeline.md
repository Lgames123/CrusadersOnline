# Asset Pipeline: User-Operated Conversion & Synthetic Fallbacks

## 1. Objective

Define the end-to-end asset pipeline that converts user-provided original game files (from the user's own *Crusaders of Might and Magic* installation) into browser-ready web standards (glTF 2.0, WebP, Ogg/MP3) without committing or distributing any copyrighted assets. Decision record: [technology-decisions.md](technology-decisions.md) ADR-003.

---

## 2. Dual Pipeline Architecture

```
+-----------------------------------------------------------------------------------+
| PIPELINE A: DEFAULT SYNTHETIC FALLBACK (Zero Assets Required)                     |
+-----------------------------------------------------------------------------------+
| Developer / Player runs the client out of the box:                               |
| - Procedural Mannequins (Rigged box-mannequin character & skeleton)               |
| - Procedural Test Arena (Greybox floor with grid texture, pillars, ramps)         |
| - Web Audio API Synthesizer (Chirps, sword whooshes, hit thuds via oscillators)   |
| RESULT: 100% playable vertical slice without any original game files.             |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
| PIPELINE B: USER-OPERATED CONVERTER (For Licensed Game Owners)                    |
|             ONE TypeScript implementation (converter/), TWO hosts                 |
+-----------------------------------------------------------------------------------+
|                    converter/src/formats/  (pure parsers, no Node/DOM APIs)       |
|                    converter/src/emit/     (glTF via @gltf-transform/core)        |
|                         ^                              ^                          |
|        +----------------+----------+       +-----------+-----------------+        |
|        | Host B1: Node CLI         |       | Host B2: Browser Web Worker |        |
|        | pnpm convert --input ...  |       | User picks install folder   |        |
|        | fs read, sharp encode     |       | (File System Access API /   |        |
|        | -> local/generated/       |       |  <input webkitdirectory>)   |        |
|        | (GIT-IGNORED)             |       | OffscreenCanvas encode      |        |
|        +---------------------------+       | -> OPFS / IndexedDB         |        |
|                                            +-----------------------------+        |
| Both hosts produce the same manifest.json + .glb/.webp/.json outputs.             |
+-----------------------------------------------------------------------------------+
```

Conversion steps (identical in both hosts):
1. Read `Textures/textures.zip` with `fflate`, decode `.tga` → RGBA, encode to `.webp`.
2. Read `script/*.ctx` (plain-text rules) → `rules.json`.
3. Parse `.mdl` meshes + `.ani` tracks → skinned, animated `.glb` (skins and animation channels written explicitly; generic mesh libraries cannot do this).
4. Parse `.msh` level geometry → `.glb` for rendering **and** collider data for Rapier (ADR-005).
5. Parse `.cap` creature capsules → collider definitions (once reverse-engineered).
6. Emit `manifest.json`.

---

## 3. Converter Specifications

### 3.1 Command Line Interface (Host B1)
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
pnpm convert --input "./Crusaders of Might and Magic" --out "./local/generated"
```

### 3.2 Browser Import (Host B2)
Settings → "Import original assets" → user selects their install folder. Conversion runs in a Web Worker with a progress bar; outputs are stored in the browser's Origin Private File System (OPFS), with IndexedDB as fallback. Nothing is uploaded to any server.

### 3.3 Importer Execution Rules
1. **Strict Read-Only:** The original game folder is never written to.
2. **Incremental Caching:** SHA-256 checksums of input files are checked against `manifest.json`. Unmodified files are skipped on subsequent runs.
3. **Safety Validation:** Malformed or corrupt chunks are logged as non-fatal warnings rather than crashing the conversion process. Parsers bound-check every read.
4. **Git Protection:** The output directory `local/generated/` is strictly ignored by `.gitignore`.
5. **Test Fixtures:** Parser tests use synthetic, hand-built fixture files only. Original files never enter CI.

### 3.4 Package Layout
```
converter/
├── src/
│   ├── formats/      # tga.ts, mdl.ts, msh.ts, ani.ts, cap.ts, ctx.ts (pure)
│   ├── emit/         # gltf.ts, rules.ts, manifest.ts
│   ├── hosts/
│   │   ├── node.ts   # CLI entry (fs + sharp)
│   │   └── worker.ts # Browser Web Worker entry (OPFS + OffscreenCanvas)
│   └── index.ts
└── package.json
```

---

## 4. Manifest Schema (`manifest.json`)

```json
{
  "version": "1.0.0",
  "generated_at": "2026-10-09T18:00:00Z",
  "textures": {
    "wood": "textures/wood.webp",
    "battleaxe": "textures/battleaxe.webp"
  },
  "models": {
    "drake": "models/drake.glb",
    "skel1": "models/skel1.glb"
  },
  "levels": {
    "arena01": { "render": "levels/arena01.glb", "collision": "levels/arena01.collider.bin" }
  },
  "audio": {
    "sword_hit": "audio/sword_hit.wav"
  }
}
```

---

## 5. Synthetic Asset Generation

Synthetic assets are generated in TypeScript (`client/src/assets/synthetic_factory.ts` at runtime, plus `pnpm gen:synthetic` to emit the greybox arena collider data shared with the server). No Python step is involved.
