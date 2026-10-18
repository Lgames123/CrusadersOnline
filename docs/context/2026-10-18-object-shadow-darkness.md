# Object shadow darkness slider

Date: 2026-10-18 · Agent: Claude Code · Commit: Object shadow darkness slider

## Why
Request: the object shadows looked too subtle, so the user wanted a slider to make them darker or lighter.

## Decisions and evidence
- The `objectShadowStrength` setting runs from 0.1 to 1 (default 0.6, the earlier fixed strength) and sets `propShadows.strength`.
- It is only the receivers' uniform `uPSParams.y`, so moving it redraws nothing and recompiles nothing.
- Measured on cs1b grass ground, as the brightness left inside the shadow: 96 % at 0.1, 69 % at 0.6, 28 % at 1. The ground the lightmap leaves in shade keeps the 0.85 share (`SHADE_SHARE`), so even 1 is not pure black.

## Deviations from the original
- Not original. It sits in Options → Graphics as "Object Shadow Darkness", under Object Shadows.

## How to verify
- `?level=cs1b`, Play offline, turn on Object Shadows, then drag the slider. Shadows by the wagon at (622, −314) darken live.
