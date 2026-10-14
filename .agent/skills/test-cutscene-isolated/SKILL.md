---
name: test-cutscene-isolated
description: Use to reproduce or verify a scripted sequence (cutscene), trigger or level object in a real client/server without touching the user's database or session — isolated story server and client, a guest spawned at a chosen spot.
---

# Testing a cutscene in isolation

The user's own dev server (port 8090) owns `local/pgdata` and may hold their logged-in
character: never test against it (a second login is refused, "character already in world").

## Setup
1. In `.claude/launch.json` add a temporary server config (remove it afterwards):
   `pnpm --filter @crusaders/server start` with env `SERVER_PORT=8190`,
   `ARENA=level:<act>`, `DATABASE_URL=pglite:memory` (fresh each start: triggers fire again for a
   new guest), `DEV_GUEST_SPAWN=x,y,z` (metres, mirrored frame).
2. Start it and the existing `story-client` config (Vite on 3100, proxies to 8190).
3. Log in with "Play as guest". `window.__co` exposes session, scene, camera, level, input.

## Picking the spawn
- Trigger volumes are in `placements.story.triggers[].volume` (feet, mirrored). Check the floor:
  `__co.level.light.sample(new Vector3(x, nearY, z), color)` returns the floor height or null
  (no floor: the guest falls).
- To enter a trigger by walking: spawn outside it, set `__co.input.locked = true`,
  `input.yaw = …` (0 faces −Z), then dispatch `keydown`/`keyup` `KeyW` on `window`.

## Traps
- Spawned straight inside a trigger, the entry fade never lifts (it only clears outside
  cutscenes): force `#fade` opacity 0 from script while testing.
- A hidden browser tab runs at ~8 fps and stalls fades: front the tab.
- The in-app browser reaches the user's dev server only at `http://[::1]:3000`.
- Hook `avatar.playAsm` to log which clips a puppet plays and when.

## Cleanup
Stop both servers and remove the temporary launch config as soon as the check is done.
