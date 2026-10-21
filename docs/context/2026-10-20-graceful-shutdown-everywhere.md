# Every stop of the server saves characters (Windows too)

Date: 2026-10-20 · Agent: Claude Code · Commit: Graceful shutdown on every stop: stop:server, IPC dev restarts, crash flush

## Why
The user lost character progress when admin was granted on local/pgdata: the server was stopped with a hard kill, which skips the final flush (periodic flush is every 60 s, worker.ts `PERSIST_EVERY_TICKS`).

## Decisions and evidence
- On Windows no process can deliver SIGINT/SIGTERM to another node: `Stop-Process`, `taskkill /F`, `child.kill()` are all TerminateProcess. `node --watch` restarts with `child.kill()` (even with `--watch-kill-signal=SIGTERM`, seen on the user's process), so every dev restart was a hard kill.
- `pnpm dev:server` is now `scripts/dev.ts`: fork + IPC `{t:'shutdown'}`, fs.watch recursive on server/src and shared/src (.ts/.json), 300 ms debounce, SIGKILL only after 30 s. Ctrl+C reaches the child itself; the runner just waits.
- `pnpm stop:server`: main.ts writes `local/server-control.json` (pid, port, random token, databaseUrl); `POST /control/shutdown` with `x-control-token`, same machine only (403 otherwise); Caddy proxies only /api /ws /healthz. Written by main.ts only, so tests never touch it.
- main.ts `shutdown()`: SIGINT, SIGTERM, SIGHUP (console window closed, Windows kills ~10 s later), SIGBREAK, IPC, control endpoint, uncaughtException/unhandledRejection (exit 1). 25 s deadline. A signal during startup waits for the start to finish, then stops.
- `pnpm admin` refuses while a live server holds the same PGlite URL (control file + pid alive).

## Gotchas
- A hard kill still loses up to 60 s of everyone's progress; nothing can catch it. Docker: `docker compose stop` (SIGTERM to node as PID 1) was already graceful.
- After `stop:server` the dev runner stays up and waits for a file change to start again.
- Agents editing server/shared files restart the user's dev server (gracefully now).

## How to verify
- Seen: dev.ts on 8097 with a scratch PGlite — file touch → "shutting down: saving characters" / "shutdown complete" / listening again; `stop:server` → stopped, control file removed; POST without token → 403. Integration tests not run (stopped). Ctrl+C and console close not exercised.

## Follow-ups
- In-game shutdown countdown from the admin panel (admin-panel note follow-up).
