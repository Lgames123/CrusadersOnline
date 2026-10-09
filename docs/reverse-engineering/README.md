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

- [file-inventory.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/file-inventory.md) — Comprehensive, non-sensitive inventory of all 1,867 installation files.
- [executable-analysis.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/executable-analysis.md) — PE32 header breakdown of `crusaders.exe`, linker version, imported DLLs, and subsystem architecture.
- [asset-format-discovery.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/asset-format-discovery.md) — Binary format structures for `.mdl`, `.msh`, `.ctx`, `.ani`, `.cap`.
- [runtime-observations.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/runtime-observations.md) — Gameplay loop timing, input polling rates, camera orbits, and physics.
- [save-format-analysis.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/save-format-analysis.md) — Save slot files (`Gamers/`) and progression serialization.
- [gameplay-mechanics.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/gameplay-mechanics.md) — Damage calculations, combo recovery frames, enemy aggro radii.
- [unknowns.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/unknowns.md) — Active research items and required experiments.
