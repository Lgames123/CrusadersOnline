# Intro movies offered at character creation

Date: 2026-10-19 · Agent: Claude Code · Commit: New characters are offered the original's introduction; the converter turns the Bink movies into WebM · Supersedes: —

## Why
CMP-003: the user decided the original's startup movies become an offer when a character is created.

## Decisions and evidence
- Original: 0x00499760 opens `media\movies\%s` (falls back to `_setup\movies\`): cinematic 0 = "CMMIntro.bik", 'c' = "3DO.bik"; startup plays 3DO then CMMIntro. The play loop 0x00499950 ends the current movie on WM_KEYDOWN Esc / Space / Enter (0x1B, 0x20, 0x0D) or WM_LBUTTONUP; the next one then plays. The client does the same; the Skip button skips both.
- Files: CMMIntro.bik 640x480 15 fps, mono 44.1 kHz, 2:20 (`BIKf`); 3do.bik (lower case on disk) 640x480 30 fps stereo, 5.4 s.
- Output WebM VP8 + **Vorbis** (`MOVIE_ENCODE_ARGS`, shared by both hosts): ffmpeg.wasm 0.12.10's libopus crashes ("memory access out of bounds") on any input, libvorbis works. Intro ≈ 27.6 MB (native) / 24.4 MB (wasm).
- Node host: the player's own ffmpeg (`FFMPEG` or PATH), probed for binkvideo / libvpx / libvorbis; missing → warning, no movies. ~5 s for both.
- Browser host: ffmpeg.wasm **core** only (no `@ffmpeg/ffmpeg` wrapper, no npm dependency), fetched from jsdelivr when the folder has movies, SHA-256 checked (`FFMPEG_CORE`), imported from a blob URL with `wasmBinary`; one core reused for both movies. GPL-2.0-or-later, not bundled or hosted: same footing as calling the user's ffmpeg. Measured on the page's main thread: 3DO 2.9 s, intro 56 s.
- Manifest gains `movies` (key → path) without a version bump (`loadPrevious` merges with an empty manifest). `inputs['movies:encode']` = the encode args: changing them re-transcodes.

## Deviations from the original
- Not at every start: a "Watch the introduction, then enter the world" box in the creation dialog (checked by default, shown only when cmmintro is converted). Checked → 3DO + intro → enters the world with the new character; unchecked → back to the list as before. Options → Introduction (title screen and in game) plays them again.

## Not done / not decoded
- The in-browser importer was verified by running `wasmMovieTranscoder` in the page, not through the Game files folder picker / worker end to end (the picker can't be driven).
- Movie volume is fixed (no setting); the title / level music is held while it plays.

## Gotchas
- In game the menu stays logically open (`optionsOpen`) under the movie so nothing takes the pointer; the movie's window-capture key listener swallows every key (hotbar digits included).
- Video `src` points at /generated/… directly (dev middleware or the service worker); the dev middleware now types `.webm`.
- A `pnpm convert` with unchanged textures drops `rules.materials` from manifest.json (pre-existing; the file stays, nothing reads the key).

## How to verify
- `pnpm convert` → `local/generated/movies/{3do,cmmintro}.webm`; `tests/unit/converter.test.ts` (movies).
- Isolated server (`DATABASE_URL=pglite:memory`) + client, create an account, + Create new character: 3DO then the intro, Esc skips, then Ws9a's opening sequence.

## Follow-ups
- Exercise the browser import end to end with a picked folder (Chrome), and check Safari plays WebM VP8 + Vorbis.
