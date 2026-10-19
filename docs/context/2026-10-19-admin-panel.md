# Admin panel

Date: 2026-10-19 · Agent: Claude Code · Commit: Admin panel: live chat log, moderation, rate events, custom spawns, player tools, audit log

## Why
Server staff need to watch chat, moderate players and run impromptu events (rates, custom monsters) without touching the code or the database.

## Decisions and evidence
- Separate page `client/admin.html` (second Vite build input), plain DOM like the game UI. It talks to `/api/admin/*` with the normal `co_session` cookie; `api.ts` refuses accounts without `accounts.is_admin` (403 `not_admin`) before `admin/admin_api.ts` runs.
- Who is an admin: `ADMIN_USERS=name1,name2` (granted at start and at sign-in), or `pnpm admin grant|revoke <username>` (stop a server holding the PGlite dir first).
- Main thread `AdminService` (server/src/admin): chat ring buffer (500 lines) streamed to the panel as server-sent events (`GET /api/admin/stream`); events, spawns registry, audit. Zones answer through a new worker request/reply (`{t:'request'}` → `{t:'reply'}`, 5 s timeout): `report` (players' HP/level/position, custom spawns), `spawn`, `despawn`, `player` (heal/revive, unstuck, gold ±, XP, item, summon to a player of the same zone).
- Rates (`WorldRates` xp / gold / drops / respawn) are pushed to every zone (`ZoneManager.setRates`, also in worker data for zones started later). Running events multiply. Drops: loot-table chances × rate, and the expected count of a placement's carried items (never keys / quest items). Respawn: corpse time ÷ rate.
- Events (`admin_events`, migration 006) always have an end (default 60 min, `DEFAULT_EVENT_MINUTES`); start now or scheduled. A 1 s timer starts/ends them, announces in chat if asked, and greets characters entering the world while one runs. Started-before-restart events are not re-announced.
- Moderation lives on `accounts` (`banned_until`, `ban_reason`, `muted_until`; permanent = year 9999, `PERMANENT_UNTIL`). Ban/timeout revoke web sessions, kick, and refuse login (403 `banned` with the reason). Mute: in-memory per account in `SessionManager` (seeded from the ticket) + DB. Timeout = ban with a length (default 10 min). Cannot ban/mute/kick yourself.
- Custom spawns: `WorldZone.spawnCustom` = archetype + overrides (name, HP, XP, gold, own loot with quantity, scale, damage ×, speed ×, aggressive = `fightsNearest`), next to a player / zone start / x,y,z. Gone when they expire, or after the corpse time if not respawning. A zone with custom spawns is pinned (not stopped when idle). `ENTITY_SPAWN.scale` carries their size to clients.
- Staff lines are `system` lines with `kind: 'admin'`: the game chat shows them on every tab with an [Admin] tag.

## Deviations from the original
- All of it (MMO operation). With no admins and no events the game is unchanged.

## Not done / not decoded
- Guests (no account row): kick and in-memory mute only; ban/timeout just kick.
- Whispers between players are logged in the panel (moderation); no player-side notice of that.
- Chat log is not persisted (memory, 500 lines); custom spawns die with a server restart (events don't).
- Speed × on humanoid creatures scales the clip rate server-side; clients still play the clip at normal rate.
- No map picker for spawn points (coordinates in metres, or a player's spot).

## Gotchas
- `label { display:flex }` beat the `hidden` attribute: admin.html forces `[hidden] { display:none !important }`.
- `/api/admin/*` is dispatched inside `createApiHandler` (needs the session check); a new admin route goes in `admin_api.ts`.
- Zone requests run in the worker's message handler between ticks: keep them cheap.

## How to verify
- `pnpm --filter @crusaders/tests exec vitest run integration/admin unit/admin_zone`.
- launch.json `admin-server` + `admin-client` (port 8193 / 3103, `ADMIN_USERS=admin`, own DB): register `admin`, open http://localhost:3103/admin.html; Play as guest in another tab, then Players → Spawn here, Chat → announce, Events → Double XP.

## Follow-ups
- Map picker / "spawn at my character" for in-game admins; server shutdown countdown; IP bans for guests; persisted chat log with retention.
