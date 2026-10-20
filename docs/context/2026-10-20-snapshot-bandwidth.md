# Snapshot bandwidth: 22 → 4.3 KB/s per client at 100 players

Date: 2026-10-20 · Agent: Claude Code · Commit: Snapshot bandwidth to 4.3 KB/s per client at 100 players (production load target)

## Why
The production load target is 5 KB/s per client with 100 players (performance-testing.md §4). The measured rate was 22.2 KB/s with 100 bots in `ca1a`.

## Decisions and evidence
- **Wire format (network-protocol.md §3.2):**
  - varint entity ids and removals;
  - an int16 millimetre position delta from the baseline when it fits (mask bit 7);
  - a 16-byte header for a standing receiver, with the jump block and velY only when non-zero (it was 36 bytes);
  - the baseline is named by an age byte (max 255; the server keeps it within 20).
- **Per-receiver rates (`updateInterval`):**
  - every tick for the nearest 8 and anything within 4 m;
  - every 2, 4 or 8 ticks by distance rank (8 / 16 / 24 and beyond);
  - beyond 40 m at least every 4 ticks, beyond 52 m every 8;
  - an HP change goes out at once.
- **Measured** with `bot_swarm.ts`, which now prints the down rate after everyone is in:
  - 22.2 → 4.3 KB/s, the same in two runs;
  - JSON control messages are ~0.45 KB/s of that;
  - full snapshots are under 2 %.
- **Key invariant:** an entity left out decodes as the baseline's (possibly older) value.
  - The server's history entry for that tick stores exactly what the client decodes (`current` is rewritten in place in `snapshotPlan`).
  - The client draws only the entities written in the snapshot (`decodeSnapshot`'s `sent`), never the decoded map.
  - `tests/unit/snapshot_rate.test.ts` checks every tick that what the viewer draws equals the server's `p.sent` state.

## Deviations from the original
- With a handful of creatures within 40 m (the original's levels), everything is still 20 Hz, so the feel is unchanged.
- Only crowds beyond the nearest 8, or entities past 40 m, are drawn at a lower rate, with extra interpolation delay of (interval − 1) ticks.

## Not done / not decoded
- p99 tick is not met: worst p99 is 18–31 ms against the 15 ms target, varying run to run on this desktop.
  - About 65 % of the tick is character-controller queries.
  - The controller settings were left alone: they are the movement fidelity, and client prediction must match them.
- Not checked live in the browser. For normal play the client's sampling is equivalent to before: interval-1 entities get a sample every tick they change, and a hold at t−1 when they start moving.

## Gotchas
- Old clients cannot read the new snapshot: the client and server must deploy together. There is no protocol version byte.
- `encodeSnapshot` throws if given a baseline more than 255 ticks back.
- The ranking uses a Float64 key `cm × 65536 + index`, so it assumes fewer than 65536 entities in interest.
- `p.sent` records are mutated in place. Don't keep references to them across ticks.

## How to verify
- In `tests/`, run `npx vitest run unit/snapshot_rate.test.ts unit/protocol.test.ts`.
- For bandwidth, run `node load/bot_swarm.ts --bots 100 --seconds 30 --arena level:ca1a` and read the `down per client` line.

## Follow-ups
- Tick p99: cheaper queries for creatures far from players, or measuring on the production host.
