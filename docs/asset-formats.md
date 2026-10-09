# Asset Formats: Binary Specifications & Decoders

## 1. Overview & Discovered Formats

This document provides binary layout specifications for each original format discovered in the 1999 *Crusaders of Might and Magic* PC distribution.

---

## 2. Textures: `textures.zip` (Standard ZIP / TGA)

- **Container:** Standard PKWARE ZIP archive (82.8 MB, 2,045 files).
- **Contained Format:** Truevision Targa (`.tga`).
- **TGA Header Layout (18 bytes):**
  - Offset `0x00` (`uint8`): ID Length
  - Offset `0x01` (`uint8`): Color Map Type (0 = None, 1 = Palette)
  - Offset `0x02` (`uint8`): Image Type (2 = Uncompressed RGB, 10 = RLE RGB)
  - Offset `0x0C` (`uint16`): Width in pixels
  - Offset `0x0E` (`uint16`): Height in pixels
  - Offset `0x10` (`uint8`): Bits per pixel (16, 24, or 32)
  - Offset `0x11` (`uint8`): Image Descriptor (Origin location)
- **Decoder:** Python `PIL.Image.open` or Three.js `TGALoader` reads these directly with zero modifications.

---

## 3. Configuration Tables: `script/*.ctx` (Plain Text)

- **Encoding:** ASCII / Windows-1252 text.
- **Comment Prefix:** `#`
- **Delimiters:** Whitespace or Tab (`\t`).
- **Record Structure:** `TOKEN <val1> <val2> <val3> ...`
  - E.g.: `DM 25 20 20` (Drake Might on Easy, Medium, Hard).
  - E.g.: `DR0 0.6 0.9 1.2` (Damage Resistance type 0 multiplier).
- **Parser Implementation:** Line-by-line regex tokenizer converting table rows to JSON.

---

## 4. 3D Meshes: `Models/*.mdl` (Little-Endian Binary)

- **Header Offset Structure:**
  - `0x00 - 0x03` (`uint32`): Header Size / Version (typically `0x1C` = 28)
  - `0x04 - 0x07` (`uint32`): Flags / Subtype
  - `0x08 - 0x0B` (`uint32`): Vertex Count $V$
  - `0x0C - 0x0F` (`uint32`): Face / Triangle Count $F$
  - `0x10 - 0x1B` (`float32[3]`): Bounding Box Center $(X, Y, Z)$
- **Vertex Stride (32 bytes per vertex):**
  - `0x00 - 0x0B` (`float32[3]`): Position $(X, Y, Z)$
  - `0x0C - 0x17` (`float32[3]`): Normal Vector $(N_x, N_y, N_z)$
  - `0x18 - 0x1F` (`float32[2]`): Texture Coordinates $(U, V)$
- **Index Stride (6 bytes per triangle):**
  - `0x00 - 0x05` (`uint16[3]`): Vertex Index Tuple $(i_0, i_1, i_2)$

---

## 5. Collision Boundaries: `Caps/*.cap` (Capsules / Bounding Volumes)

- **Record Structure:**
  - Array of bounding capsules:
    - Base Point: $(X_1, Y_1, Z_1)$ `float32`
    - Top Point: $(X_2, Y_2, Z_2)$ `float32`
    - Radius: $R$ `float32`
    - Material / Surface Tag: `uint32` (Stone, Wood, Dirt, Water)
