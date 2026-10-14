---
name: decompile-crusaders
description: Use when a behaviour of the original Crusaders of Might and Magic must be settled from its code — decompile, disassemble or cross-reference crusaders.exe with Ghidra (headless, read-only), find which routine handles something, or read a vtable-only method.
---

# Decompiling crusaders.exe

The project settles behaviour from the original's code and data first; runtime captures only fill
named gaps and never overrule the code. Record what you learn in
`docs/reverse-engineering/` (behaviour and addresses only, never copied code).

## Tools
- Ghidra 12.1.4 at `C:/Users/Lencina/Documents/ghidra_12.1.4_PUBLIC`; analysed project
  `C:/Users/Lencina/Desktop/CrusadersDecomp` (program `/crusaders.exe`). The Ghidra MCP is often
  down: use headless.
- Runner: `tools/re/ghidra/headless.sh <Script.java> <out file> [args...]` (read-only, ~10 s).
  Scripts in `tools/re/ghidra/`:
  - `DecompileAt.java out addr...` — decompile the functions containing the addresses.
  - `DecompileCreate.java out addr...` — create a function at each address first (in memory
    only), then decompile. Needed for vtable-only methods (most of the mover / camera code).
  - `Disasm.java out start end` — raw disassembly of a range (find `RET`s and function starts).
  - `Xrefs.java out addr...` — references to an address, with the instructions around each.
  - `FindScalar.java out hex...` — instructions whose operands hold these constants.
  - `StringRefs.java out regex maxFuncs` — defined strings matching (case-insensitive), their
    referencing functions, decompiled.

## Traps
- Arguments pass through `cmd.exe`: no `(`, `)`, `|`, `&` in them (regexes included).
- Many routines are reached only through vtables and are not functions in the database; a
  direct call search finds nothing. Read the vtable from the PE (`.rdata` raw offset =
  VA − 0x4DE000 + 0xDE000) and decompile its entries with `DecompileCreate`.
- `Xrefs` misses indirect calls; scan the bytes for `E8` rel32 calls to the target when needed.
- Matrices in the engine are column-vector (translation in the last column).
- The converter mirrors Z (left- to right-handed): turns about X and Y change sign there, turns
  about Z keep theirs.
