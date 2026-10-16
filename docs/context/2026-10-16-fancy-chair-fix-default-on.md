# Fancy Chair UV fix on by default

Date: 2026-10-16 · Agent: Claude Code · Commit: Fancy Chair UV fix on by default; pending prompts and story test types · Supersedes: the "off by default" line of 2026-10-16-fancy-chair-uv-fix.md

## Why
The user asked for the fixedPropUvs setting to be on by default.

## Deviations from the original
- `fixedPropUvs` is the one non-original setting that defaults on: missing or anything other than `false` reads as on, so only an explicit off keeps the original mapping. "Reset All to Defaults" turns it back on. `CLASSIC_SETTINGS` carries it as `true` despite the name.

## Gotchas
- `localhost.har` stays untracked on purpose: it embeds converted level data (ci9a/ci9b placements, manifest), which the zero-IP rule keeps out of git.
