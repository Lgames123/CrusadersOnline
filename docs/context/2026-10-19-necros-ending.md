# The ending: Necros's death timeline, Cs5b's last scene, the post-game

Date: 2026-10-19 · Agent: Claude Code · Commit: Necros's death plays the original's ending, then the story stays complete and every door opens

## Why
Killing Necros did nothing: bs1a has no death trigger and no exits, so the campaign could not be
finished. The user decided:
- keep the original's scenes;
- stay in Cs5b afterwards;
- give the ending to everyone who hurt Necros;
- only record completion for now (reward to be decided).

## Decisions and evidence
- `0x0044C6A0`: a creature's death with type 0x96 calls `0x0044F7B0`. That routine runs:
  - three fixed shots of the body at 10 ft (±60° and 0°, world axes, aimed at his local
    (0, 4, 2) ft), then a high shot at 3.5 s;
  - time scale 0.1, 0.5 from 3.5 s;
  - a FADE to white at 7.5 s over 3 s;
  - the load of "CS5B" at 10.5 s.
- Cs5b's start 0 lies in trigger 231582, so Seq24 plays on arrival. It ends with exit "end".
  No portal or relay of any act leads to Cs5b.
- Details are in executable-analysis §24 and `shared/src/game/ending.ts`.
- `hurtBy` on mobs: players who caused damage, with an ally's blows credited to its owner.
  Threat is not used, because sight alone adds to it.
- `StoryState.completedAt` (Unix ms) is set and saved at the death, so leaving during the
  timeline loses nothing. A finished character joining bs1a is sent on to Cs5b, since the ship has
  no way out.
- During the timeline the player is `ending`:
  - held still, as in a cutscene (`scripted(p)` now covers both);
  - out of `hostile()`;
  - takes no damage.

## Deviations from the original
- Exit "end" (the game-over state) loads nothing. The character stays in Cs5b and gets a Server
  chat line.
- Post-game: `completedAt` skips the door guard. `openDoor` uses plain reach instead of the
  triggers, so any door opens from either side, key or not, sealed ones included; lever-driven
  ones still need their lever. PLAYER_STATS sends `storyComplete`, so the client prompts the same
  way.
- The slow motion is client-side only (remote clips, effects, debris and decals at
  dt × scale). The server world keeps its pace.

## Not done / not decoded
- The completion reward (CMP-008) and waypoints (CMP-002).
- The `0x004E0C30` event at 10.5 s and the player's `SLTI` status in `0x0044F7B0`.
- Scripted exits (volume-less act changes) are not opened by the post-game. Only doors are.

## Gotchas
- Name tags and the HUD stay up during the timeline, as in every cutscene.
- `__co.level` in the dev hook is captured once, so it still names the first act after a zone
  change.

## How to verify
- `pnpm test:unit`: ending.test.ts (timeline, who gets it, the load at 10.5 s, the ship rule,
  Seq24's "end", saved date, real bs1a / cs5b data) and doors.test.ts (the post-game door case).
- Live check done on an isolated server:
  - `ARENA=level:bs1a`, `DATABASE_URL=pglite:memory`, `ADMIN_USERS=<test account>`;
  - a Necros with 3 HP spawned via `POST /api/admin/spawns {at:{player:<guest>}}`;
  - result: kill → shots and white fade → Cs5b → Seq24 → "You have finished the story…",
    still in Cs5b.

## Follow-ups
- Completion reward. Waypoints. Whether the post-game should also open volume-less act changes.
