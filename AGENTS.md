# CrusadersOnline — instructions for agents

This file is the single source of project rules for every agent (Claude Code, Gemini CLI,
Antigravity, others). `CLAUDE.md` and `GEMINI.md` only point here: change rules here.

## Context notes (simplified SDD)

Every commit carries a context note: a short Markdown file that the next session or agent, of any
tool, can read to pick the work up without re-deriving it. Notes written by one agent are read by
the others: same folder, same format, plain Markdown.

- **Before starting work**, read `docs/context/INDEX.md` and open the notes that touch the area
  you are about to change.
- **With every commit**, write a note in `docs/context/` named `YYYY-MM-DD-<short-slug>.md` (follow
  `docs/context/TEMPLATE.md`, including the `Agent:` field), add one line for it at the top of
  `docs/context/INDEX.md`, and stage both in that same commit.
- **Only what the next session needs**: decisions and the evidence behind them (decompiled
  addresses, data checks), deviations from the original game, what is known to be missing or not
  decoded, traps and gotchas, how to verify, follow-ups. Not what `git log`, the diff or the code
  already say (file lists, line-by-line changes, narration). Short is better: a few bullets per
  section, empty sections left out.
- A later note that supersedes an earlier one says so (`Supersedes: <file>`); do not rewrite old
  notes.
