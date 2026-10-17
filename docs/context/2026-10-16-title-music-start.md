# Title music starts past its silent intro

Date: 2026-10-16 · Agent: Claude Code · Commit: Title music starts past the track's silent intro

## Why
The login/title screen seemed muted for its first seconds: the Citadel hall track (ci1b, CD track 14) opens near-silent.

## Decisions and evidence
- ffmpeg astats on `music/14.mp3`: RMS below -80 dB until ~3.1 s, -57 dB at 3.4 s, -45 dB at 3.6 s, about -25 dB from 5 s. The title starts it at 3.5 s (`TITLE_MUSIC_START` in `front_end.ts`).
- `MusicPlayer.play(track, startAt)` seeks only on the first pass (on `loadedmetadata`). The loop still wraps to 0, so later passes keep the full intro.

## Deviations from the original
- The original title starts the CD track from 0. This change is always on and cosmetic.

## Gotchas
- The offset is tied to track 14. If the title act or its track changes, measure the new one again.
- The seek is dropped when another track is picked before metadata loads.

## How to verify
- Open the title screen and click once. In the console, the looping `Audio` reports `currentTime` ≈ 3.5 right after unlock.
