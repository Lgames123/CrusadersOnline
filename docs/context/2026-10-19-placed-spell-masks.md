# Placed creatures use their own spell masks: elementals charge

Date: 2026-10-19 · Agent: Claude Code · Commit: Creatures cast from their placement's spell mask: Ice and Rock Elementals charge instead of throw-walking · Supersedes: 2026-10-19-missing-monsters.md (its "throw-walk" for every elemental)

## Why
Playtest: elementals barely moved. They looped on an empty fire-ball "throw" (icewalk, 8 ft
every ~3 s) from range because the brain used the template table's mask (0x20 / 0x80).

## Decisions and evidence
- A placed creature's stats, spell mask (+0x1F8) included, are copied from its record
  (0x00432D50); the template mask is only for code-made creatures (spectral ally, 0x0043FEF0).
  Record offset: XP block +0x38 (stats base = XP block − 0x1C0). Converter 1.31 emits `spells`.
- Placed masks: Ice Elemental 0, Rock 1 (stone skin, never chosen), Lava 0x80 (keeps the
  throw-walk), Shadow 4 (soul drinker), Greater Black Knight 2 (lightning), Necros 0x34E (+lightning),
  Dark Mage / Master several variants (executable-analysis §22).
- Decide (0x004096A0) re-read: the ranged choice needs 0x0040E5F0 (a castable 0x2E2 bit), and castable
  (0x004281D0, `push 0`) is always true for a set bit, so the mask alone decides.

## Gotchas
- Newly casting: Shadows (soul drinker at 8–20 ft), Black Knights (lightning), a few mage variants.
  Their clips exist on every humanoid model (PK01/02/04/05).
- Placements converted before 1.31 fall back to the template mask: reconvert.

## How to verify
- `pnpm test:unit` (missing_monsters.test.ts). ca1b, the alcove Rock Elemental at (2680, 1012, −1908):
  it runs at the player and punches within ~1 s (monsters-server launch config).
