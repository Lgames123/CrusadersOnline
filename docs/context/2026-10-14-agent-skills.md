# Project skills for Antigravity (and every agent)

Date: 2026-10-14 · Agent: Claude Code · Commit: Project skills and the Ghidra headless scripts

## Why
Repeated procedures (decompiling, converting, inspecting data, testing cutscenes, committing)
kept being re-derived each session; they now live as skills any agent can load or read.

## Decisions and evidence
- Skills are folders with a `SKILL.md` (frontmatter `name` + `description`) in `.agent/skills/`,
  the Antigravity workspace location (Google's codelab); Antigravity loads one when its
  description matches the request. `AGENTS.md` points Claude Code and Gemini CLI at the same files.
- The Ghidra scripts written during the mover / texture work are now versioned in
  `tools/re/ghidra/` with `headless.sh` (read-only, ~10 s a run).

## Gotchas
- Skills and `headless.sh` name this machine's paths (Ghidra in Documents, the CrusadersDecomp
  project); override with `GHIDRA_HOME` / `GHIDRA_PROJECT_DIR` elsewhere.
- Antigravity's reading of `AGENTS.md` and `.agent/skills` comes from third-party write-ups and
  Google's codelab, not a reference page: check it loads them (ask it which skills it sees).

## How to verify
- `tools/re/ghidra/headless.sh DecompileCreate.java <out> 0x0048ED10` prints the mover reset.

## Follow-ups
- Add a skill when a new procedure repeats (e.g. Frida runtime capture, the deploy).
