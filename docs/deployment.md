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

## 6. TLS, backups, CI (M11, 2026-10-09)

- **TLS:** set `SITE_ADDRESS` to the public domain and `WEB_PORT=80`, `WEB_TLS_PORT=443`, `COOKIE_SECURE=true` in `deployment/.env`. The domain's DNS must point at the host with ports 80/443 reachable. Caddy then obtains and renews the certificate and redirects HTTP to HTTPS. **HSTS** (`max-age=31536000; includeSubDomains`) is sent only on HTTPS responses, so local `:80` testing is unaffected. The Caddyfile was validated with a domain address; obtaining a real certificate needs a real domain and has not been exercised.
- **Backups:** compose service `backup` writes a `pg_dump` every 24 h into `deployment/backups/` and keeps 7 days; `deployment/backup/restore.sh` restores one. See backup-and-recovery.md (restore drill done locally).
- **CI:** `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:
  - typecheck;
  - unit and integration tests against PGlite **and** a PostgreSQL 18 service container;
  - the Playwright two-browser E2E (Playwright's Chromium);
  - Docker builds of both images. Publishing is opt-in: with the repository variable `PUBLISH_IMAGES=true`, builds on `main` are pushed to GHCR as `ghcr.io/<owner>/<repo>-server` and `-web`, tagged `main` and `sha-<commit>`.

## 6.1 Original game content (no original files are hosted)

- **Players** import their own copy of Crusaders of Might and Magic in the browser. The *Original game files* panel (top right) takes the installation folder. `converter/src/hosts/browser.ts` converts it in a Web Worker (about 25 s in Edge; models, levels, lightmaps, textures, sounds, rules) into Cache Storage. The service worker `client/public/assets-sw.js` then serves it at `/generated/*`, the same URLs the dev server uses. Nothing is uploaded, and the site never serves original assets. Without an import the game uses placeholder graphics; a world running an original level asks the player to import first.
- **The server** needs collision, placements and rules for original levels. The operator converts their own copy (`pnpm convert`). Compose mounts `${GENERATED_DIR}` (default `../local/generated`) read-only into the server; set `ARENA=level:<act>` (e.g. `level:ca1a`) and optionally `ITEM_RULES=/app/local/generated/rules/items.json`.
- **Verified 2026-10-10 on the containerized stack (Caddy :8088, `ARENA=level:ca1a`):**
  - a new browser shows "Not installed" and, after login, the import request;
  - after the import and the automatic reload, the player is online in Ca_a, with the original models, at 120 FPS and with 0 corrections.
- **Same-version rule:** client prediction and server collision come from the same converter. The operator should convert with the same game version the players own (the original 1999 release; GOG 2.0.0.7 was used here).

## 7. Not yet done

- Deploying the published images to a real host and domain (first real certificate).
- Resource limits, log shipping, metrics and alerting.
- Off-host backup upload.
