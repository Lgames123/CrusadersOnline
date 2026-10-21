# Playtest fixes: game-files popup, loot beams, bars behind walls, deaths, defaults, bow, minimap

Date: 2026-10-20 · Agent: Claude Code · Commit: Playtest fixes: game-files popup, loot beams, occluded bars, instant deaths, bow arrows, minimap

## Why
Friends' playtest: nobody understood the game files must be imported; rarity unreadable on the ground; health bars through walls; deaths waited for the current clip; graphics defaults; the Dasher Hand Bow should shoot; a minimap.

## Decisions and evidence
- **Game files:** "Play offline" hidden (front_end). Entering the world (Enter world, dev guest) first awaits `hasGameFiles()`; without files a two-step dialog (GOG store link, folder picker → `importInstallFolder`, shared with the Game files panel) opens; the reload returns to the character screen (`CHARACTER_SCREEN_FLAG`).
- **Loot beams** (engine/loot_beams.ts): shaft + floor ring per rarity (Mundane/Tempered/Legendary; Battle-worn and mod-less items none), shared materials pulse; loose kill drops get one, player-drop piles show the best rarity left. Tab prompt coloured by `modsTitle`.
- **Bars behind walls:** CombatUi rays camera → head and → mid-body against the level (`CHARACTER_GROUPS`); hidden only when both are blocked. Off during cutscenes.
- **Deaths:** a COMBAT_EVENT `killed` plays the death at once: local `player.dead` (held 1.5 s against stale stats), remotes `RemoteEntities.kill` until the 100 ms-late snapshots say DEAD. Death crossfade 0.05 s (others 0.15).
- **Defaults:** enhanced lighting, object shadows, foliage on (user's request). `OPTIONS_VERSION` 3: values stored before v3 reset to on once; silhouette rule now `>= 2`.
- **Bow:** arrow class decoded from the dump: ctor 0x004BFE50 (damage SLASH 5 / AIR 5, vtable 0x4E3400 — the Boomer's base), hit 0x004C0010 (shield asked first; unblocked: push 0x004C02C0 3 ft, sound 306 + rand, damage). Here an arrow deals the shooter's own blow roll (`rollDamage(shooter, 1)`), not 5/5. `Use SHOOT` → `ItemDef.shoot`; player attack plays BOOMER_THROW and looses at its release frame along the view (`aimOf`); creatures holding a bow get a `shoot` brain phase (beyond 8 ft, ≤ 22 m, line of sight, 2.4 s cooldown, BOOMER_THROW anim = ASM_THROW_ITEM on models without a fire ball state). Shields stop arrows with mask PROJECTILE. Projectiles travel as SC_SPELL_EVENT `projectile` with `spell: 'arrow'` (ids from 1 000 000); client draws arrow01 (models.ctx 97) along the flight.
- **Minimap** (ui/minimap.ts): layout rasterised from the level collision mesh (|ny| > 0.55 floors, < 0.35 walls). A floor with more level under it (ray down > 1.2 m) is "stacked": drawn only when the player is within 2.6 m below it, so upper storeys / ceilings do not cover the floor below; floors > 25 m below dropped. Rebuilt when the player's height moves 1.5 m. Marks: party / players / enemies in sight (≤ 40 m, LOS from the eyes), townsfolk, merchants (shop volume centre), exits (named via `areaName`), crystal, rare loot. M opens the area map (north-up, drag / wheel); settings switch "Minimap" (on). Zoom and north-up kept in localStorage `crusaders.minimap`.

## Deviations from the original
- Bow shots need no Arrow (the original needs one in the bag, 0x00474E50, and none exists, so nobody ever shoots); Drake shoots on the fire ball's clip. Always on.
- Loot beams, minimap / area map, occluded bars, instant deaths: not original, always on (minimap switchable).

## Not done / not decoded
- Arrow launch speed (the stack vector in 0x00440790): 100 ft/s guessed; no gravity; arrowhead direction of arrow01 not checked (long axis aligned only).
- Cs5b's four Dasher Scouts and Tamris are townsfolk (disposition 0): only Du1c's DasherBrute4 (placement 5) is a hostile archer.
- Death not seen live (logic + typecheck only). Minimap on huge outdoor acts not timed (one ray per floor triangle at level load).

## Gotchas
- Python heredocs through this Git Bash lost backslashes (`'\n'`, `C:\\GOG`): edit such strings with the Edit tool.
- `minimap.expanded` joins every `waypointMap.open` pointer-lock check in main.ts; a new window must be added there too.
- DEV_GUEST_SPAWN did not take in Du1c (the act's start won); the bow was checked in Cs5b and by tests/unit/bow.test.ts.

## How to verify
- `pnpm test:unit` (bow.test.ts: player arrow at 0.4 s, hits at 8 m; a bow-holding skeleton shoots the player).
- launch.json `bow-server` + `bow-client` (Du1c, guest with the bow): equip it, click; M for the area map.
- Popup: on a browser without imported files, Enter world / Play as guest.

## Follow-ups
- Decode the arrow's launch speed and whether SHOOT spends an Arrow.
