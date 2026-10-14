---
name: inspect-level-data
description: Use when a question about a level must be answered from the original data files — measure .msh faces or texture coordinates, read .cap objects, triggers, sequences or brushes, follow pointers in a cap DB, or check what the converted placements contain.
---

# Inspecting level data (.msh / .cap)

Answer from the data before guessing: measure across all acts, not one example.

## Quick routes
- **Converted**: `local/generated/levels/<act>.placements.json` (brushes, motion, story
  triggers / sequences / cameras, creatures, starts) and `manifest.json` (`levels[mesh]`,
  `textures`, `textureSizes`). GLB: JSON chunk at byte 20, length at byte 12.
- **Raw**, from a Node script (TypeScript runs directly with `node file.ts`):
  - Import the converter's parsers with **`file:///C:/...` URLs** (Windows absolute paths fail
    as ESM specifiers): `converter/src/formats/msh.ts` (`parseMsh`), `cap.ts` (`parseCap`),
    `dcl.ts` (`explode`).
  - A cap DB: `explode(bytes, 0x94, u32 at 0)`; pointers are absolute, base `0x08000000`.
    Records are not 4-byte aligned: scan every byte offset when hunting a pointer.
  - Brush runtime object = record − 0x18; class word `0x31` at the record; name pointer at
    record + 0x14.
  - Copy a parser into the scratchpad to read fields it does not export (e.g. face axes at
    +0x1C / +0x28, lengths at +0x34).
- Texture pixels: `sharp` from `converter/node_modules` (run node from `converter/`).

## Units
- Original units are feet; metres = × 0.3048 (`LEVEL_UNIT_METRES`).
- Placements and three.js scenes are Z-mirrored; raw .msh / .cap are not.
