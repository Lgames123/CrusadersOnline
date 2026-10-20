# Relay ops 0–3 have no effect in the shipped game

Date: 2026-10-20 · Agent: Claude Code · Commit: Relay ops 0-3 settled: nothing in the shipped acts reads the bits they set

## Why
CMP-006 was the last step-1 item in PROJECT_STATUS §3. The question: do relay ops 0/1 (set/clear +0x0D bit 0) and 2/3 (slots 6/7) need converting?

## Decisions and evidence
- **Nothing to implement.** The converter keeps them as `flagOps`; the server ignores them.
- **Only op 0 is shipped**: 8 relays (Co2a/3a/4a/8a/9a, Ws2a–4a), each on its cell door's mover and sound trigger. Ops 1–3 appear nowhere.
- **Readers of +0x0D:**
  - The slot-9 getter 0x460240. Nothing calls it directly.
  - Two save writers, 0x459CD0 and 0x45C9D0.
  - The packed-flags accessor 0x460250. Its callers:
    - 0x40303B, a script step. It only writes.
    - The proxy trigger, vtable 0x4E1EFC (0x461650 / 0x461710). It only writes.
    - The flag-compare trigger, vtable 0x4E186C, fire 0x463640. This one reads: it checks the packed flags of every object in its +0x40 list against its +0x3C list.
- **Data check, all 8 acts:** a byte scan for pointers to each flagged trigger finds only two places: the relay's own op list and the act's type table. So no compare trigger points at them.

## Not done / not decoded
- Which file type number builds vtable 0x4E186C. The loader's class switch at 0x478600 isn't indexed by the type-list number. A +2 offset fits sound 0x0B and mover 0x1E, but would give relay 0x2B a do-nothing vtable. The pointer scan makes this unnecessary here.

## Gotchas
- If a later act or a mod has a flag-compare trigger, ops 0–3 would matter. Check for pointers to `flagOps` targets before assuming they're dead.

## How to verify
- Scratch script pattern: explode each Caps/*.cap (inspect-level-data skill), take every relay op-0 target, and scan every byte offset for its pointer (`target + 0x08000000`). Each one should have exactly 3 hits: the op list plus 2 in the type table.
