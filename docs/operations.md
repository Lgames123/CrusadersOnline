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

- `GET /health`: Returns HTTP 200 OK if server loop is ticking and PostgreSQL pool has available connections.
- `GET /metrics`: Prometheus formatted metrics:
  - `game_connected_players_count`
  - `game_server_tick_duration_ms`
  - `game_entity_count`
  - `game_db_query_duration_ms`

---

## 3. Administrative Commands

Admins are regular sessions whose account has `is_admin = TRUE` (checked against the database on every command, never trusted from the client) and execute commands over WebSocket:
- `/kick <character_id>`: Terminates socket connection immediately.
- `/spawn <monster_id> <x> <y> <z>`: Spawns dynamic monster in active zone.
- `/broadcast <message>`: Sends system announcement banner to all online players.
