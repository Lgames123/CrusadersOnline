# Backup and Disaster Recovery

## 1. What is implemented (2026-10-09)

| Item | How | Default |
|---|---|---|
| Logical dump | compose service `backup` (`postgres:18-alpine`, same major version as the database) runs `deployment/backup/backup.sh` | every 24 h (`BACKUP_INTERVAL_SECONDS=86400`) |
| Format | `pg_dump --format=custom --compress=6`, one file per run: `crusaders-<UTC timestamp>.dump`, written to a temporary file and renamed only when the dump succeeds | — |
| Location | `${BACKUP_DIR}` on the host, relative to `deployment/` | `deployment/backups/` (git-ignored) |
| Retention | dumps older than `BACKUP_KEEP_DAYS` are deleted after each successful run | 7 days |
| Restore | `deployment/backup/restore.sh <dump>` | — |

The game itself also flushes every connected character every 60 s, on leave and on shutdown (persistence.md), so a dump captures at most about a minute of unsaved play.

**Off-host copies are still the operator's job.** Copy `deployment/backups/` to another machine or to object storage, for example with a nightly `rclone copy` or a cloud sync of that directory. A backup that only exists on the game host does not survive losing that host.

## 2. Commands

```bash
# One-off backup now (in addition to the schedule)
docker compose -f deployment/docker-compose.yml --env-file deployment/.env run --rm -e BACKUP_ONCE=1 backup

# Follow the scheduled backups
docker compose -f deployment/docker-compose.yml --env-file deployment/.env logs -f backup
```

## 3. Restore procedure

```bash
sh deployment/backup/restore.sh deployment/backups/crusaders-20261010T010030Z.dump
```

The script:
1. Stops the game server, so no zone writes into a half-restored database. Players online lose any progress made since the dump.
2. Runs `pg_restore --clean --if-exists --no-owner --single-transaction` inside the `db` container. It drops and recreates every object from the dump; a failure rolls back and leaves the database unchanged.
3. Starts the server again. Migrations run on start-up, so restoring an older dump into a newer server version upgrades it.

**Drill (2026-10-09, local Docker stack):** a one-off backup (12.8 KB: 3 accounts, 3 characters) was restored with the script. Row counts matched afterwards and `/healthz` reported healthy.

## 4. Not yet done

- WAL archiving / point-in-time recovery (only useful once the player base makes a 24 h dump interval too coarse).
- Automated off-host upload and encryption at rest of the dumps.
- Periodic automated restore test (restore into a scratch database and compare row counts).
