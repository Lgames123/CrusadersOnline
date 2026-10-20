# The ending's cast is each player's own; seqNecros puts Drake in the arena

Date: 2026-10-19 · Agent: Claude Code · Commit: The ending's cast is the arriving player's own and walks off after the last scene; seqNecros puts Drake in the arena and takes Necros Before away

## Why
User review of the ending:
- The Cs5b NPCs were shared world mobs, standing there for everyone after the last scene. The
  user wants them instanced to the player of the ending, all 15, walking off and gone when
  Seq24 ends.
- "Necros's arena looks wrong" was my live test, which spawned a test Necros in the entrance
  corridor. The real fight is in bs1a's octagonal arena: Necros is placed at its centre
  (2215, 1066.9, −1576 ft). Checking it found two real faults in seqNecros, listed below.

## Decisions and evidence
- seqNecros' tracks:
  - player: Appear 1 at (2215, 1065.9, −1545.5);
  - Necros Before (22): Appear 0;
  - Necros (23): Appear 0, then Appear 1.
- Two faults found and fixed in `finishCutscene`:
  - The server only unhid creatures with any Appear 1. Each creature track's last Appear now
    decides, shared world, and hiding clears threat. Necros Before used to stay visible beside
    Necros.
  - The client moved Drake to `appearpos` while the server kept him at the door. The stand-in's
    Appear `appearpos` is now an end position, like MoveToPos.
- The ending act is found from data: the sequence whose ScriptedSequenceDone is exit "end"
  (Cs5b's Seq24). Its act's `mobSpawns` are not spawned for the world.
- `join`: a player without that scene's flag gets his own copy of the cast (`Mob.privateTo`).
  The copy is:
  - seen in his snapshots only;
  - out of `hostile()` and of `separate()` against anyone but its owner and its own cast;
  - without AI (`updateCast`);
  - mapped to his cutscene's actors.
- When the scene ends (`castLeaves`), citizens (archetype name /citizen/) walk to the nearest
  door portal (the inn) and the rest to the nearest walk-in exit (the road to Ws2a). Each copy is
  removed on arrival, after 20 s, or after 2 s without moving. Leaving the zone removes it too.

## Deviations from the original
- All of the above is an MMO adaptation: the original ends the game after Seq24.

## Not done / not decoded
- Walking is a straight line with no pathing. Most of the cast vanishes when stuck or timed out
  rather than at the exit. The removal is a plain despawn, with no fade.

## Gotchas
- A client in a hidden browser pane plays cutscenes slowly. The server ends the scene at its
  upper bound (`estimateSequenceMs` × 1.5 + 15 s) whatever the client shows. In seqNecros that
  let Necros kill the "frozen" tester. This is what made the test cutscenes look stuck.
- Synthetic key events right after page focus are sometimes dropped (`__co.input`); send them
  again.

## How to verify
- `pnpm test:unit`: ending.test.ts covers seqNecros (Drake placed, Necros Before gone, Necros
  shown), the cast being one player's own, the walk-off, and a leaving player taking his cast.
- Live check on isolated servers (pglite memory):
  - `ARENA=level:bs1a`, `DEV_GUEST_SPAWN=674.9,325.3,-464.5`, walk north: seqNecros ends with
    Drake at (2215, −1545.5) and Necros alone in the centre.
  - `ARENA=level:cs5b`, two guests: each sees 15 NPCs (his own), and after Seq24 they leave.
