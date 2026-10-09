# Development Workflow: Local Run, Debug & Hot Reload

## 1. Daily Development Workflow

### 1.1 Database
Nothing to start: by default the server uses embedded PostgreSQL (PGlite) in `local/pgdata/` and applies migrations at startup. Delete `local/pgdata/` to reset it.

To use a real PostgreSQL 18 instead, either:

- **Docker Desktop (Windows):** `docker compose -f deployment/docker-compose.dev.yml up -d --wait`, then `DATABASE_URL=postgresql://crusaders:crusaders_dev@127.0.0.1:5434/crusaders_online` in `.env`. Port 5434 avoids the native install (5433) and the WSL relay (5432).
- **Native PostgreSQL 18 (port 5433):** run `deployment/sql/create_dev_database.sql` once as the `postgres` superuser (psql prompts for your password), then `DATABASE_URL=postgresql://crusaders:crusaders_dev@127.0.0.1:5433/crusaders_online`.

Ports on this workstation: 5432 = WSL relay (only while the `dml-arch` distro runs), 5433 = native PostgreSQL 18, 5434 = Docker dev database, 8088/8443 = containerised stack (deployment.md).

### 1.2 Start Authoritative Game Server
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
pnpm dev:server
```
*Expected Output:*
```
INFO: server listening on ws://127.0.0.1:8090/ws
INFO: simulation ticking at 20 Hz
```

### 1.3 Start Browser Client (Vite Dev Server)
In a second terminal window:
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
pnpm dev:client
```
*Expected Output:*
```
  VITE vX.Y.Z  ready in 240 ms
  ➜  Local:   http://localhost:3000/
```

### 1.4 Open Browser & Play
Navigate to `http://localhost:3000/`. Vite proxies `/api` and `/ws` to the game server (same origin). The client requests a development guest ticket, joins the world and shows `ONLINE as GuestNNN` in the HUD; open a second tab to see a second player. If the server is not running the client falls back to `OFFLINE` single-player mode.

### 1.5 Tests
```powershell
pnpm test              # unit + integration (starts an in-process server on a random port; PGlite)
# Also run persistence tests against real PostgreSQL (fresh database per test group, dropped afterwards):
$env:TEST_POSTGRES_URL = 'postgresql://crusaders:crusaders_dev@127.0.0.1:5434/crusaders_online'; pnpm test
pnpm typecheck
```
