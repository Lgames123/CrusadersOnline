# Conjured spells start with the conjure sound

Date: 2026-10-18 · Agent: Claude Code · Commit: Self spells play the conjure state's sound (327) as they begin

## Why
User: every spell's cast sound missed the same part at its very beginning compared with the original.

## Decisions and evidence
- Entering ASM_SPELL_CONJURE (state 0x39) plays Sound.ctx 327 (SplSRCast01, 3.99 s) at the caster (case 0x0042A2C4 of the player's state → clip switch; executable-analysis §20.2 "Conjure sound"). It is a state sound, not a spell's +0x24 sound, which is why every self spell lacked it.
- `SPELL_RULES.conjureSound`. `castSpell` sends it at the feet along with the wind-up sound for conjured spells.
- Checked in the browser: casting Torch Light starts 327 and 315 together.

## Not done / not decoded
- The other cases of that switch (states with random clip picks at 0x0042A1D4..0x0042A260) were not checked for sounds.
- The +0x24 cast sounds still play at the hand. The original plays them at the character's position (only a few feet away).

## How to verify
- `spells-server` + `spells-client`: `__co.session.selectSpell('torch_light'); __co.input.onAction('castSpell')` starts two sounds (327 and the torch level's).
