# Death drops the shield and upper-body layers

Date: 2026-10-18 · Agent: Claude Code · Commit: Dying drops the raised shield and upper-body swings at once

## Why
Dying while blocking (or mid side swing / moving cast) kept that upper-body layer over the death clip.

## Decisions and evidence
- `LocalPlayer.render` calls `setState(ANIM.DEAD)` before `setShield(false)`, and `setShield` ignores calls once dead, so the shield layer was never lowered. `OriginalAvatar.setState` now stops the shield action and any upper swing/cast outright (no fade) on entering DEAD, before the death clip is applied, so it plays on the full body.

## Gotchas
- `setShield`, `setUpperSwing` and `setUpperClip` still no-op while dead; anything layered must be cleared in `dropLayers`, not by those calls.

## How to verify
- Hold block (or start a side swing) and die: the death clip plays whole, arms included; after respawn blocking raises the shield again.
