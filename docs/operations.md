# Operations: Monitoring, Telemetry & Maintenance

## 1. Structured Logging & Telemetry

The authoritative server uses **Pino** for structured JSON logging. In production, logs are formatted as single-line JSON objects for ingestion by Loki, Datadog, or Grafana:

```json
{
  "level": 30,
  "time": 1728490000000,
  "pid": 4201,
  "hostname": "game-node-01",
  "tick": 24050,
  "connectedPlayers": 48,
  "tickDurationMs": 4.12,
  "msg": "Server tick completed"
}
```

---

## 2. Health Checks & Metrics Endpoints

- `GET /healthz`: 200 with the default zone, the running zones, its tick and the player count (the compose healthcheck).
- `GET /metrics` (`server/src/http/metrics.ts`): Prometheus text format, on the server's port only. Caddy never proxies it, so a scraper on the compose network reads `server:8080/metrics`. With `METRICS_TOKEN` set it wants `Authorization: Bearer <token>`.
  - `crusaders_online_players`, `crusaders_zones`, `crusaders_zone_players{zone}`;
  - `crusaders_zone_tick_p50_ms`, `_p99_ms`, `_max_ms`, `crusaders_zone_late_ticks` (per zone, the last 5 s window);
  - `crusaders_pending_saves`, `crusaders_uptime_seconds`, `crusaders_process_rss_bytes`, `crusaders_process_heap_used_bytes`.
- A zone whose slowest tick in a window passes 45 ms logs a warning (`zone tick over 45 ms`, performance-testing.md §4): alert on it from the logs, or on `crusaders_zone_tick_max_ms > 45`.
- Suggested alerts: p99 over 20 ms for 5 min, any late ticks for 5 min, pending saves above 0 for 1 min (the database is slow or down), and no `backup ok` / `offsite ok` line in 26 h.

---

## 3. Administrative Commands

Admins are regular sessions whose account has `is_admin = TRUE` (checked against the database on every command, never trusted from the client) and execute commands over WebSocket:
- `/kick <character_id>`: Terminates socket connection immediately.
- `/spawn <monster_id> <x> <y> <z>`: Spawns dynamic monster in active zone.
- `/broadcast <message>`: Sends system announcement banner to all online players.
