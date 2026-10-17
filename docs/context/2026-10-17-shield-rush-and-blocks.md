# Shield rush and stopped blows as the original

Date: 2026-10-17 · Agent: Claude Code · Commit: Shield rush and blocked blows follow the decompiled code · Supersedes: the rush part of 2026-10-14-lighting-textures-movers-cutscenes.md (guessed sounds)

## Why
User: rework the shield bash to match the original; block sounds / sparks looked wrong; asked whether wooden vs steel shields and weapon kinds sound different.

## Decisions and evidence
- Full write-up with addresses: `docs/reverse-engineering/executable-analysis.md` §8.6b.
- Rush (`0x493F20`, flag 0x40000 for the whole RAM_SHOULDER state): the charge is stopped by a body, pushes it 0.3 of the overlap, and each blocked tick rolls; success = victim impact (creatures reel from the push, then the logged knock-down; players stunned), rushing player −1 HP through `loseHp` (flinch, can die), sounds 0 + 338 at the rusher. No shield check, so a creature's bash now stuns a blocking player (was stopped by the block before). Creatures' bash uses the same contact code; its old arc hit at the impact frame is gone.
- Roll rate: 5 % per original step at `RUSH_STEPS_PER_SECOND = 120` → ~26.5 % per 20 Hz tick. 120 is a calibration to the Frida log, not a decoded number.
- Blocks: player shield → 343; creature shield → metal row by attacker edge (`sharp` in the event = weapon SLASH > BASH, so the Axe 5/5 is blunt). Wood vs metal shield: no difference in the original — answered no, nothing added.
- Sparks: 3 pairs along the attacker's blade sweep (`sweep` in the event, world x/z), grey 0.3 s light (was orange 0.18 s).
- Landed-hit sounds now pick from the five-variant rows; hits on the player and on props are always 306.

## Deviations from the original
- Characters do not collide in Rapier here; the body block is redone on the server only during a rush (the rusher is pulled back to contact: a reconciliation correction on the client).

## Not done / not decoded
- Where the creatures' IMPACT_SEVERE after a rush comes from (kept from the log).
- Necros rush extras (push 30, knock-down); low-detail single spark pair; ice/elemental block materials 3/4.
- Not checked live in the browser.

## Gotchas
- `separate()` used to call `setCharacterState` without the action, cancelling a creature's charge (and any timed action) when it overlapped; it now uses `moveBy`, which keeps it.
- A rush event whose target is the rusher is its own 1 HP cost: the client plays nothing for it.

## How to verify
- `tests/unit/combat.test.ts` "shield rush" block (random 0 = every roll succeeds; alternating rolls force the skeleton's bash).
- In game: Space + RMB into a skeleton; hold the shield against skeletons (sword → sharp clanks) and Shadows (Heavy Mace → blunt clanks).

## Follow-ups
- Live capture of contact rolls per rush to confirm the 120 steps/s calibration.
