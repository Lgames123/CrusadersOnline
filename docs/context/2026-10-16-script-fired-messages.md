# Script-fired message triggers (relay op lists, death triggers)

Date: 2026-10-16 · Agent: Claude Code · Commit: Relays run their decoded ops: exits, brushes, sounds, creature ops, use key, messages

## Why
Volume-less message triggers never showed: Du2a #18 "Got Dain's Scepter and Dasher Necklace",
Cs4b #25 "Got Talisman of True Sight" (see 2026-10-16-sign-messages.md).

## Decisions and evidence
- Type 0x2B gets vtable **0x4E1E84** (loader switch: byte table 0x479958, jump table 0x47984C),
  not 0x4E1EC0. The old `+0x36 / +0x38` target list (fire 0x462B90) belongs to that other type,
  so every converted relay had `targets: []` before this.
- 0x2B fire (slot 5, 0x463CC0) runs `+0x3C` ops of 16 bytes at `+0x40`; op 8 + arg type 0x14
  fires the target's slot 5 directly. Touching it (slot 2 0x463A90 walk-in, slot 4 0x463C70
  from a script) arms a `u16 +0x38` ms timer first; slot 5 called directly skips the timer.
  Converted as `targets` (op 8 only) + `delay`.
- Creature death 0x44CA00: at 0 HP, if health object (type 0x5E) `+0x1F4 & 0x8000000`, fires
  `+0x1F0` (slot 5) with the player as activator. Converted as `story.deaths[]`. Only Du2a has
  one: OgreOutlaw7 → relay 401805 → quest triggers 401749, 401693, message 401637, exit op du9a.
- Cs4b: flag (Seq13), quest and relay 419185 share one volume; relay delay 7000 ms → message.
- resolveRef returns `{ message: id }`; the server sends `SC.STORY_MESSAGE` (0x4E) to the player
  who fired it, and the client shows the text from its level's `story.messages`.
- `checkStory` now fires every trigger touched in one check, not stopping at the first that starts
  a cutscene (the original touches all at once; Cs4b's text lands 7 s into Seq13).

## Deviations from the original
- Walk-in timer starts once, on entry; the original re-arms it on every touch check while inside
  (Cs4b's volume is a 4-unit line, so no visible difference).
- Message shares the subtitle box with sequence dialogue (original: HUD message line).
- MMO: the death trigger fires for the killer only, once per character (story flag).

## Not done / not decoded
- Relay ops other than 8→trigger (0/1 enable/disable, 2/3 slots 6/7, 0x0A–0x0E creature ops) are
  not converted. Exit refs in targets are ignored. Du2a's op on exit du9a (slot 5 of type 0x13) is
  not decoded: check what it does before wiring it.
- Relays now really fire their trigger targets (Ws5a 354011 → relays 353715 / 353631, Gl3c 72827
  → 73000) when the server fires them; use-key (bit 3) relays are still not fired by the server.

## How to verify
- `pnpm test:unit` (story_zone.test.ts: death → message + quest; walk-in relay after 7 s, once).
- Isolated server (test-cutscene-isolated) `ARENA=level:cs4b`, `DEV_GUEST_SPAWN=550.77,293.2,-655.3`:
  Seq13 line, then "Got Talisman of True Sight" at ~7 s, then "Drake: Thanks."
- Du2a: kill OgreOutlaw7 (creature 36, ~719, 312, -524 m) → "Got Dain's Scepter…" (only the
  client display was checked live; a fresh guest loses that fight).
