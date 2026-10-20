# Production readiness: /metrics, off-host backups, go-live checklist

Date: 2026-10-20 · Agent: Claude Code · Commit: Prometheus /metrics, off-host backup copies and a go-live checklist (production)

## Why
Stage 2.6 of the plan asked for a real domain with TLS, off-host backups and metrics. The domain and host belong to the operator, so this commit prepares everything up to that step.

## Decisions and evidence
- **TLS** was already done: Caddy obtains the certificate when `SITE_ADDRESS` is a domain. Nothing changed there.
- **`/metrics`:**
  - served by `server/src/http/metrics.ts` on the server port only, so it is not reachable from the internet;
  - Caddy proxies `/api`, `/ws` and `/healthz`, never `/metrics`;
  - `METRICS_TOKEN` optionally requires a bearer token, compared with `timingSafeEqual`;
  - the gauges come from the zone hosts' last 5 s window (`ZoneHost.lastMetrics`).
- **Tick alarm:** the server logs a warning when a window's max tick is over 45 ms (`TICK_ALARM_MS`, performance-testing.md §4).
- **Off-host copies:**
  - done by the compose service `offsite` (`rclone/rclone:1.68.2`, `--profile offsite`), on its own `egress` network so the database stays on `internal`;
  - `--immutable` copies only the finished `crusaders-*.dump` files, never the `.part` files;
  - remote retention is `OFFSITE_KEEP_DAYS`;
  - encryption comes from the operator's rclone `crypt` remote.
- Compose now passes `GAME_FEATURES`, `ADMIN_USERS`, `REALM_NAME` and `METRICS_TOKEN` to the server. Before this, the first three could not be set in Docker.

## Not done / not decoded
- No real deployment and no real certificate: that needs the operator's domain and host.
- The `offsite` script was checked with a stub `rclone`, and the compose file with `docker compose config`. The rclone image was not pulled or run.
- No container resource limits and no log shipping.
- The load swarm cannot target a deployed server: it starts its own in-process server.

## Gotchas
- `deployment/rclone/` holds credentials and is git-ignored. Keep the crypt passwords somewhere other than the game host.
- The dump retention on the host (`BACKUP_KEEP_DAYS`, 7) and on the remote (`OFFSITE_KEEP_DAYS`, 30) are independent.

## How to verify
- Run `npx vitest run unit/metrics.test.ts` in `tests/`.
- Run `docker compose -f deployment/docker-compose.yml --env-file deployment/.env.example --profile offsite config -q`.
- With the stack up: `docker compose exec server wget -qO- localhost:8080/metrics`.

## Follow-ups
- Follow `deployment.md` §7 on the real host, including a restore drill from the off-host copy.
