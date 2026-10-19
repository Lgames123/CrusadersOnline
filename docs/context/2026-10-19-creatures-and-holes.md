# Creatures stop at ledges and die in deep falls

Date: 2026-10-19 · Agent: Claude Code · Commit: Creatures stop at a ledge instead of running into a hole; a deep fall kills them

## Why
In Ca*b the skeletons chased Drake off the pillars into the pit and stayed there alive: never
dead, they never respawned (and no player could reach them).

## Decisions and evidence
- Ledge: before each creature step, if its input moves it, a ray down 0.9 m ahead (along yaw +
  movementAxes) must find floor within 2 m (LEDGE_DROP) below the feet + 0.5 m; else the move keys
  are dropped (it stands at the edge, chasing / returning resumes when the way is clear).
  Brushes are colliders, so the Ca*b planks count as floor.
- Timed actions (lunges, bashes, knock-backs) ignore input: if a step leaves the floor with no
  floor within 2 m below, the creature is put back where it was (its action keeps running).
- Deep fall: `fallFrom` = height when it left the floor; landing more than 8 m lower (DEEP_FALL),
  or going below the level's fall limit, kills it (`loseHp(m, m, hp)`: no XP, no loot, no death
  trigger). It then respawns at its spawn after the archetype's respawnTicks, as any death.

## Deviations from the original
- Not original (creature ledge handling not decoded); always on.

## Gotchas
- Spell slow / freeze path (rate < 1, the early return in updateMob) skips the ledge probe; it
  moves at a fraction of its speed, pushes rarely matter there.
- A creature knocked off by a spell's push (`moveBy`) is not put back: it falls and dies if deep.
- The kill broadcasts a COMBAT_EVENT with attacker = target.

## How to verify
- `pnpm test:unit` (fall_catch.test.ts "creatures and holes": a synthetic gap fails without the probe).
- In game: Ca1b, cross the planks with skeletons following; jump to the side pillar: they stop at the edges.
