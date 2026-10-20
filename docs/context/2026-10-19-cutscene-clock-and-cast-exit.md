# Cutscenes keep real time and end with the server; the ending's cast walks round walls and fades

Date: 2026-10-19 · Agent: Claude Code · Commit: Cutscenes keep the real clock and end with the server; the ending's cast walks round obstacles and fades out; the stand-in starts where Drake is

## Why
User report: a test screen ended with Drake out of bounds, over the sea. The user also asked to
fix the two limits left by the cast change: straight-line walking that vanishes without a fade,
and server-ended cutscenes (a client that played them slowly could be killed while frozen).

## Decisions and evidence
- **Out of bounds.** A sequence that starts on an act's first tick (Cs5b's Seq24) comes before
  any frame has drawn Drake. During a cutscene the client skips `local.render`, so the stand-in
  (`local.object`) sat at the origin, which is out of the mesh, for the whole scene. At its end
  `endCutscene` placed Drake there.
  - With the server alive, reconciliation snapped him back.
  - My test tab had lost its server, so he stayed at sea.
  - Fix: `playCutscene` puts the stand-in at the character's position when it is more than
    0.5 m away (and faces it along `input.yaw`).
- **Cast walking.** `castWay` probes `wallDistance` 1.2 m ahead at 0.9 m, plus floor 0.9 m
  ahead. It tries straight on, then turns of 0.5 to 2.5 rad on its own side first, then the
  other side.
  - The side is kept between ticks: trying both sides at each turn made it dither along a wall.
  - Held up means no 0.5 m nearer its exit in 3 s. Measuring raw movement let one Cs5b scout
    pace a nook until the 25 s timeout.
- **Fade.** On arrival, when held up, or at 25 s, the server sends `SC_ENTITY_FADE`
  `{ id, seconds: 1 }` to the owner and removes the mob 1 s later.
  - The client fades through each mesh's `onBeforeRender` / `onAfterRender`, setting the
    opacity only around that mesh's own draw: avatar materials may be shared, and cloning them
    loses ModelLighting's hooks.
- **Cutscene clock.**
  - The client's cutscene, the ending timeline and a cutscene's puppets now run on real
    elapsed time (up to 1 s a frame), not the frame dt clamped by MAX_FRAME_MS.
  - When the server's upper bound ends a sequence, it sends `SC_CUTSCENE { end: true }` and the
    client stops it.
  - A player in a sequence is out of `hostile()` and takes no damage, as in the ending.

## Deviations from the original
- Players in a scripted sequence are invulnerable and ignored by creatures (MMO: the world goes
  on around them).

## Not done / not decoded
- No real pathfinding: a cast member boxed in from the start fades out where it stands.
  Cs5b's DasherScout3, on a ledge, does this at once.
- The client end on `end: true` was checked by code and the server unit test only, not with a
  page in the background.

## Gotchas
- A page in a hidden Browser pane draws seldom. Before this change its cutscenes fell behind;
  now they keep pace but jump in big steps.

## How to verify
- `pnpm test:unit`: ending.test.ts covers the cast going round a wall to the door, fading for
  its owner alone, and the server ending a sequence its client never closed with nothing
  hurting the player meanwhile.
- Live check (isolated server, `ARENA=level:cs5b`, pglite memory): the stand-in is at start 0
  through Seq24, which ends in real time. Then 15 fades: the 5 citizens enter the inn, the others
  head for the Ws2a road.
