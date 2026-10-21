# Reverse Engineering Guide & Forensic Index

## 1. Methodology & Clean-Room Principles

This directory documents the empirical forensic investigation of the 1999 PC release of *Crusaders of Might and Magic* (GOG distribution).

All analysis follows strict clean-room engineering:
1. **Observable Behavior & Header Dissection:** We examine PE headers, imported dynamic libraries, configuration files, and binary record layouts to understand math, coordinate frames, and formats.
2. **Zero Code Copying:** Disassembled assembly sequences are never copied into the engine. Mechanics are reimplemented in TypeScript from behavioral specifications and mathematical models.
3. **Evidence Tagging:** Every technical conclusion is assigned a confidence rating:
   - `[CONFIRMED]`: Verified directly via binary headers, strings, or empirical code execution.
   - `[STRONGLY INFERRED]`: Supported by multiple consistent artifacts (e.g. DLL names, standard libraries).
   - `[TENTATIVE]`: Plausible hypothesis awaiting dynamic testing or parser confirmation.
   - `[UNKNOWN]`: Unresolved question tracked in `unknowns.md`.

---

## 2. Forensic Documents Map

- [file-inventory.md](/docs/reverse-engineering/file-inventory.md) — Comprehensive, non-sensitive inventory of all 1,867 installation files.
- [executable-analysis.md](/docs/reverse-engineering/executable-analysis.md) — PE32 header breakdown of `crusaders.exe`, linker version, imported DLLs, and subsystem architecture.
- [asset-format-discovery.md](/docs/reverse-engineering/asset-format-discovery.md) — Binary format structures for `.mdl`, `.msh`, `.ctx`, `.ani`, `.cap`.
- [runtime-observations.md](/docs/reverse-engineering/runtime-observations.md) — Gameplay loop timing, input polling rates, camera orbits, and physics.
- [save-format-analysis.md](/docs/reverse-engineering/save-format-analysis.md) — Save slot files (`Gamers/`) and progression serialization.
- [gameplay-mechanics.md](/docs/reverse-engineering/gameplay-mechanics.md) — Damage calculations, combo recovery frames, enemy aggro radii.
- [unknowns.md](/docs/reverse-engineering/unknowns.md) — Active research items and required experiments.

---

## Methodology update (2026-10-09)

- **Data-first.** File formats are reverse-engineered from the data files themselves with read-only probes in `tools/re/` (e.g. `mdl_probe.py`). Each hypothesis is confirmed only when it reproduces exact file sizes and redundant header values (bounding boxes) across the whole asset set.
- **Disassembly (IDA Pro via MCP)** is used for what the data cannot answer: animation playback, physics constants and combat timings. Decompiler output stays in `local/` (git-ignored). Only findings, written in our own words, go into these docs; no disassembled code goes into the source tree (clean-room policy).
- **Status:** `.mdl` fully specified (265/267 files) and converted to glTF; `.ani` in progress; `.msh` and `.cap` not started.
