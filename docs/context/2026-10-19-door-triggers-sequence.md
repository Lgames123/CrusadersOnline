# Doors open from the original's triggers; no sequence breaks through shared doors

Date: 2026-10-19 · Agent: Claude Code · Commit: Doors open only from the original's own triggers, keys and sides; Gl3c's pad needs Revelation learned

## Why
User: Ca1c's Glaciers door opened before Duskwood was done (sequence break). Any door opened with
Tab from either side; the original's door scripting was "not decoded" and a hand-made lock table
stood in. Asked for a general pass on sequence breaking (returning to old maps is fine, skipping
ahead is not).

## Decisions and evidence
- Doors are opened by their own mover triggers (0x1E → brush at +0x38). The player's touch test
  0x460320 answers activation bit 0 (walk in), bit 3 (use key), 0x20 (walk in carrying the item
  named at trigger +0x10; else refused). Converter 1.33 writes them as `story.doors`; the arena
  gives each door `useFrom` (volume, side) and `plane` (shut slab). No volume = never touched.
- Ca1c/Ca2c `bDoor3` (Glaciers): both triggers on the Glaciers side (z 1108–1117 ft, slab 1127,
  hub sign at 1132+): a return door. Ca3c adds one on the hub side (act 3 is the route: Gl1a's
  intro cutscene sits at the Ca3d entrance). Ca1c `bDoor4`: Mica's Key only; Ca3c `bDoor4`: no volumes.
- Item triggers in all acts (byte scan of every .cap): Ca1c bDoor4 Mica's Key, Train
  `bmetaldoor_left/right` Fain's Key, Cs1b-Inn `bDoorE_4` Room 2 / `bDoorE_3` Room 3. The old table
  had Train `bfinaldoor` (it is walk-in 0x301) and the inn's `bDoorE_5` wrong; it is gone.
- Never opened by hand now: Co*a / Ws2–4a `bCellDoor3`, Bs1a `bnecrosdoor`, Ws9a `bCellDoor`
  (relays still move the last two).
- Gl3c → Gl4c exit and relay 72827 are activation 0x10000: player stats +0x1FC bit 0, a one-frame
  latch (0x44D9B0) of +0x200 bit 0, set by GRANT_SPELL's use (0x4013F0, sound 406). So the exit
  fires on learning Revelation from the book on the pad, not by walking on it (`onLearn`).
- Exits otherwise checked: activation 0x10 exits are script-only in 0x460320 (already `scripted`,
  except the Cs↔Ci gates kept walkable on purpose, see 2026-10-16-exit-arrival-as-original).
  Gl2b's Rune exit (0x4020) targets Gl1c, which doesn't ship: not converted.

## Deviations from the original
- MMO guard (always on): doors are shared, so crossing a guarded door (one not openable from both
  sides by everyone) from a side the player couldn't open it from himself is undone (position put
  back). A legit crossing records story flag `<act>-door:<object id>`, which allows it both ways
  afterwards (returning players).
- Item triggers also open with Tab/Z while standing in them carrying the key; walk-in triggers open
  on entering (edge, not every tick); the once bit 0x200 is ignored for doors.

## Not done / not decoded
- Activation 0x40 (game-state mask `*(0x630F7C)+2` bit +0x30) and 0x10000 on non-exit triggers
  other than Gl3c: none on doors. 0x4000 only matters for sound triggers.
- No "locked" sound on a refused item trigger (the caller passes it; doors pass none found).

## Gotchas
- `useFrom` absent = levels converted before 1.33: doors open from anywhere (old behaviour).
  Reconvert (`pnpm convert`) and restart the server.
- A trigger only counts from its own side of the slab: some volumes lie a foot from the door and
  the body test would reach through it.
- The guard snaps the server position back; the client's prediction rubber-bands.

## How to verify
- `pnpm test:unit`: doors.test.ts (sides, item trigger walk-in, guard with a returning player,
  real Ca1c/Ca2c/Ca3c/Train/Inn data), story_zone.test.ts "an exit fired by learning a spell".
- In game: Ca1c hub side of the Glaciers door shows no prompt and Tab does nothing; Mica's door
  says "Locked — needs Mica's Key" without it.

## Follow-ups
- Decide whether the Cs↔Ci gates (walkable, not original) should follow the story too.
