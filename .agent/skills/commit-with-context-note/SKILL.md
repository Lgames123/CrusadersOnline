---
name: commit-with-context-note
description: Use whenever making a git commit in this project — stage explicit files, check Zero-IP, verify, and write the context note (docs/context) that every commit must carry.
---

# Committing

1. **Look first**: `git status --short`. Other sessions or agents may have pending work in the
   tree; commit only what the user asked for, or say what else is there.
2. **Zero-IP check** on the diff and untracked files: no original assets or their data (images,
   audio, models, level geometry, base64 / long binary strings), nothing under `local/` or the
   install folder. Assets are only ever read from `/generated` at run time.
3. **Verify**: `pnpm typecheck`; `pnpm test` (~20 s) unless the user asked to skip it — say so in
   the reply when skipped.
4. **Context note** (rule in `AGENTS.md`): `docs/context/YYYY-MM-DD-<slug>.md` from
   `docs/context/TEMPLATE.md`, plus one line at the top of `docs/context/INDEX.md`. Only what the
   next session needs: decisions and evidence, deviations from the original, gaps, gotchas, how
   to verify. Not file lists or diffs.
5. **Stage explicit paths** (never `git add -A` / `git add .`), including the note and the index.
6. Commit message: a subject line, then bullets on behaviour and evidence (decompiled addresses);
   end with the attribution line the agent's own instructions ask for.
7. Report the hash and anything left uncommitted.
