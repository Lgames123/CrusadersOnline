# Footprints, body thuds and bloodstains from clip events

Date: 2026-10-20 · Agent: Claude Code · Commit: Footsteps leave footprints and dead bodies hitting the ground leave bloodstains

## Why
Fidelity gap from the decals note (2026-10-18): BLOODSTAIN and footprints were not stamped.

## Decisions and evidence
- Clip event table `0x4E0F90` (name, sound, handler):
  - LEFTFOOTSTEP / LEFTFOOTSTE (0x0E) and RIGHTFOOTSTEP (0x0F) → `0x00457890`;
  - HEAVYTHUD (0xCE) and LIGHTTHUD (0xCF) → `0x004577F0`.
- `0x00457890`:
  - stamps L_ / R_FOOTPRINT (kinds 7 / 8, 0.8 ft, floors only) at the foot dummy (0x18 / 0x1C)
    along the character's heading;
  - then plays the material's step sound (volume 0.6 for anyone but the player);
  - all of it only with the game-config bit `[0x608B98] & 0x1000000`, which is set in the user's
    latest.cfg.
- `0x004577F0`: if the body's physics state is 3 and its HP ≤ 0, it stamps BLOODSTAIN (3 ft) at
  its position, then plays the event's thud. `0x0044C6A0` stamps one at death too (when in
  state 3).
- Client:
  - every character with clip events (the local player and remote avatars) runs these;
  - a foot is 0.12 m to the side of the body (the dummies aren't read);
  - blood goes under the body at a thud when it is dead.
  - Thud sounds 206 / 207 now play.

## Not done / not decoded
- `0x0044DD50` (a vtable method at 0x4E0B48 that stamps BLOODSTAIN unconditionally, skipped
  when game-state bit `[0x630F7C]+1 & 2` is set): its caller isn't known, so bleeding while
  alive is not stamped.
- The config bit 0x1000000 is not exposed as an option. Footprints are always on.

## How to verify
- monsters-client, walk forward 3 s: `__co.decals.live.length` grows by one per step (6 seen).
