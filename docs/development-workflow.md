# Development Workflow: Local Run, Debug & Hot Reload

## 1. Daily Development Workflow

### 1.1 Database
Nothing to start: by default the server uses embedded PostgreSQL (PGlite) in `local/pgdata/` and applies migrations at startup. Delete `local/pgdata/` to reset it.

To use a real PostgreSQL 18 (Docker; on this workstation Docker runs inside the WSL distro `dml-arch`):
```powershell
wsl -d dml-arch --cd /mnt/c/Users/Lencina/Desktop/CrusadersOnline -- docker compose -f deployment/docker-compose.dev.yml up -d --wait
```
then set `DATABASE_URL=postgresql://crusaders:crusaders_dev@127.0.0.1:5432/crusaders_online` in `.env`. WSL stops its VM when no WSL process is running, which takes the container down with it; keep a terminal open with `wsl -d dml-arch -- sleep infinity` while developing against it.

### 1.2 Start Authoritative Game Server
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
pnpm dev:server
```
*Expected Output:*
```
INFO: server listening on ws://127.0.0.1:8080/ws
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
$env:TEST_POSTGRES_URL = 'postgresql://crusaders:crusaders_dev@127.0.0.1:5432/crusaders_online'; pnpm test
pnpm typecheck
```
