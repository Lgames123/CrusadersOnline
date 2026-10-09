# Deployment Guide: Containerization & Production Topology

## 1. Topology

```
            browser ──HTTP(S)/WSS──▶  web (Caddy)  ── /api/*, /ws, /healthz ──▶  server (Node 24)  ──▶  db (PostgreSQL 18)
                                      static client                               zone worker(s)          volume pgdata
```

| Service | Image / Dockerfile | Notes |
|---|---|---|
| `db` | `postgres:18-alpine` | Volume `pgdata`; healthcheck `pg_isready`; internal network only |
| `server` | `deployment/Dockerfile.server` | Runs the TypeScript sources directly (Node 24 type stripping); production deps only; runs as `node`; healthcheck `GET /healthz`; migrations applied at startup |
| `web` | `deployment/Dockerfile.client` | Vite build of the client served by Caddy; reverse-proxies `/api/*`, `/ws` (WebSocket upgrade) and `/healthz`; automatic TLS when `SITE_ADDRESS` is a domain |

Only synthetic assets are shipped. `.dockerignore` excludes the original game folder, `local/` (converted assets, PGlite data), `.env` files and docs; the dev-only model viewer is not part of the client build.

## 2. Configuration (`deployment/.env`, git-ignored)

Copy `deployment/.env.example`:

| Variable | Local test | Production |
|---|---|---|
| `DB_PASSWORD` | random | long random secret |
| `SITE_ADDRESS` | `:80` | `play.example.com` (Caddy obtains the certificate) |
| `COOKIE_SECURE` | `false` (plain HTTP) | `true` |
| `WEB_PORT` / `WEB_TLS_PORT` | `8088` / `8443` | `80` / `443` |

`NODE_ENV=production` is baked into the server image: the development guest endpoint is disabled, so players register accounts.

## 3. Commands

```powershell
# Shell: PowerShell — Working Directory: CrusadersOnline/
Copy-Item deployment/.env.example deployment/.env   # then edit DB_PASSWORD
docker compose -f deployment/docker-compose.yml --env-file deployment/.env up -d --build --wait
docker compose -f deployment/docker-compose.yml --env-file deployment/.env ps
docker compose -f deployment/docker-compose.yml --env-file deployment/.env logs -f server
docker compose -f deployment/docker-compose.yml --env-file deployment/.env down          # keeps volumes
```
Local test: open `http://localhost:8088`.

## 4. Shutdown and persistence

`docker stop` / `restart` sends SIGTERM. The server then:
1. stops accepting connections,
2. stops the zone worker, which flushes every character still in the world to the database,
3. closes WebSockets (terminating peers that do not answer within 1 s) and idle HTTP connections,
4. waits for pending saves and closes the database pool.

Saving never depends on clients completing the WebSocket close handshake (covered by the "unresponsive client" integration test).

## 5. Verified (2026-10-09, Docker Desktop 29.8.2 on Windows)

- All three services start healthy from a cold `up --build`; migration `001_initial_schema.sql` runs against the container database.
- Through Caddy on :8088: static client served, guest endpoint returns 404, registration sets an `HttpOnly; SameSite=Strict` cookie, ticket → WebSocket upgrade → world entry, 20 ticks of movement with 0 corrections.
- `docker compose restart server` with a player connected: the character's position is restored exactly after the restart (≈1.5 s).

## 6. Not yet done (M11)

- TLS on a real domain (`SITE_ADDRESS`), HSTS.
- Database backups (`pg_dump` schedule, restore drill) — see backup-and-recovery.md.
- Image publishing (registry, tags), CI build, resource limits, log shipping and metrics.
