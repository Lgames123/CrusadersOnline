# Casts on the run are no longer dropped

Date: 2026-10-19 · Agent: Claude Code · Commit: Casts on the run: on the ground as the animation sees it, and a recast just before the end is taken

## Why
Holding W while casting, the clip sometimes played with no sound and no spell: the client started the cast, but the server refused it silently (the sound and effect come only from the server's `begin`/`release`).

## Decisions and evidence
- The cast gate was raw `character.grounded` on both sides. Running over a bump or a stair edge leaves the ground for a tick or two (why `looksGrounded` exists for the run clip). The client and server sample that at different moments, so one said yes and the other no. Both gates now use `looksGrounded`: grounded, or not jumping and falling slower than 4 m/s.
- The server also drops a released cast within `CAST_END_GRACE_TICKS` (2) of its end when a new cast arrives. The client times its clip by its own clock, so a recast could land before the server's `end`.

## Deviations from the original
- 0x0042B7A0 checks being on the ground. A tick or two of a step-off now counts as ground (to match what the player sees), and that is not traced in the original.

## Gotchas
- The client never rolls back a cast the server refused: any server-only refusal (selected spell, mana spent elsewhere, swing still on the server) still shows a silent clip.

## How to verify
- Hold W across stairs or bumpy ground (cs1b) and spam a bolt spell: each clip should have its sound and its effect.

## Follow-ups
- A refusal reply (or a `begin` timeout on the client) to cancel the local clip.
