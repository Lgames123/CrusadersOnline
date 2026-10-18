# MMO systems design specification

Date: 2026-10-18 · Agent: Claude Code · Commit: MMO systems design specification and its brief

## Why
The MMO design brief (`MMO Design/design_prompt_1.md`) and the specification written from it were untracked; they are committed so later sessions can read them.

## Decisions and evidence
- The authoritative spec is `docs/game-design/mmo/` (README index + volumes 01–13, including the passive skill tree in 13). `MMO Design/` only keeps the brief and a navigation README pointing there.
- These are design proposals, not implemented behaviour and not decompiled facts; nothing in code depends on them yet.

## Gotchas
- Faithful original feel stays the default (see the project's decomp-first rule): MMO systems from this spec (rarity/affixes, +10 upgrading, auction house, crafting) are additions to make optional or clearly marked as non-original when implemented, not "fixes".

## Follow-ups
- Open decisions are tracked in `12-open-decisions-and-risk-register.md`; the staged plan is `11-implementation-roadmap.md`.
