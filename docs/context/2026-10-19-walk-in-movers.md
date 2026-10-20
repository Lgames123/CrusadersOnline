# Walk-in movers: wheels, crushers, chandeliers, gears

Date: 2026-10-19 · Agent: Claude Code · Commit: Ci*b's wheels, Gl*b's crushers, the inns' chandeliers and Bs1a's gears start when walked under

## Why
CMP-004: the walk-in mover triggers other than Ca*b's bridges were left at rest.

## Decisions and evidence
- Inventory (every .cap, mover triggers 0x1E outside doors): Bs1a `bgears01/02`, Ci1-4b/Ci9b
  `bBigWheel1/2` + `bLongWheel1/2` (one shared volume), Cs1-3b-Inn `bChandelier1` (activation 1),
  Gl1-4b `bStalagCrusher1-8` (0x201, once; Gl1b has no 7). Cs4b-Inn's chandelier and Ws5a's
  `bAirship` triggers have no volume: they never move, as in the original. Converter 1.34 writes
  every walk-in one as a one-op relay (was `/bridge/` only).
- Mover flags (placements `motion.flags`, not the trigger bytes): wheels 0xC45 and gears 0xD05 =
  mode 5 (loop forever; 14.4 s / 36 s a turn), chandelier 0x4002401 = mode 1 ping-pong ±5° eased,
  crusher 0x1002016 = mode 6 (once), eased in (0x2000 + 0x1000000): 128 ft in ~1.14 s, gathering
  speed (ln(b/a)/(b−a) ms).
- **Crushers do no damage.** The contact routine 0x48E370 (only the player, `DAT_00542fb0`): flag
  0x100 skips it, 0x200 reverses (state 2 ↔ 6), 0x80 holds; otherwise it calls the mover's
  vtable+0x4C (vtable 0x4E372C, slot = 0x402840, an empty function) and pushes him along with the
  mover's own move, up to 4 tries, then restores its pose (holds). A crusher landing on Drake
  pushes him into the floor, fails, and waits on his head; it falls on once he steps away. The
  "with damage" in the backlog row had no support in the code.
- Only Bs1a's gears carry any of 0x80/0x100/0x200 (0x100: never touch him). `MoverDef.contact`
  carries the decoded mapping; `reverseMover` is there for 0x200, used by no shipped mover.
- `worldTrigger` now takes walk-in mover-only relays whatever their 0x200 bit: the use (0x48EC10)
  starts only a shut (1) or parked (5) mover, and a crusher never returns to either (mode 6 back
  end leaves state 6; forwards end is 9), so the once bit changes nothing in a shared world and a
  saved per-character flag would only go stale.

## Deviations from the original
- 'push' movers hold instead of pushing (unchanged from before; for a vertical crusher the
  original ends up holding too). Riding a mover still goes through `carryOnBrush`; 0x48E370's rider
  list (objects with physics bit 1 whose probe 0.5 down hits the mover, up to 10) matches that idea.

## Not done / not decoded
- Contact is only tested for 'move' segments (`moverHits`): turning wheels, chandeliers and gears
  never touch anyone here. Wheels have no 0x100, so in the original a wheel could push Drake.
- Crushers, wheels, gears and chandeliers are not in `SOLID_BRUSH`: drawn and moved, not collided
  with (a fallen stalactite can be walked through).
- Flags 0x10 / 0x40 / 0x400 / 0x1000 are not read by the mover routines (0x48E370, 0x48EFC0,
  0x48F170, 0x48FFC0, 0x4900C0, 0x48EC10); 0x800 only skips a per-move callback (+0x108).

## Gotchas
- Converted before 1.34: only the bridges move. `pnpm convert`, restart the server.
- Gl*b's Ice Titans stand 14–40 ft from most crushers (not crusher 4): live tests there get the
  guest killed. A crusher falls for good the first time anyone walks under it, until the zone
  restarts.
- With the browser pane hidden the client ticks at ~2 fps: client mover copies lag the server.

## How to verify
- `pnpm test:unit`: walk_in_movers.test.ts (flags, speeds, Ci1b wheels started by walking in, Gl1b
  crusher holding on a player unhurt then falling on, left alone falling to DONE).
- Live (checked): isolated server ARENA=level:gl1b, DATABASE_URL=pglite:memory, guest spawned under
  crusher 4 (746.15, 224, −97.23 m): it stops at progress 0.72–0.80 over his head, HP unchanged,
  falls to the floor once he steps 15 ft aside; walked in from the side, it falls to the floor.
  Ci1b (579.1, 240, −471.5 m): all four wheels state 2 on arrival.

## Follow-ups
- MMO decision: crushers stay down after the first passer until the zone restarts. Re-arming
  them (a timer back to shut) would be a non-original option.
- Contact for turning movers (needs the brush's posed collider instead of the box test).
