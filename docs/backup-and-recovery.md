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

**Off-host copies:** the compose `offsite` service (`deployment/backup/offsite.sh`, rclone image, only with `--profile offsite`) copies every finished dump to `OFFSITE_REMOTE` every `OFFSITE_INTERVAL_SECONDS` (1 h). It deletes remote dumps older than `OFFSITE_KEEP_DAYS` (30). Set it up once:
1. Create `deployment/rclone/rclone.conf` (git-ignored) with `rclone config` on any machine: a bucket remote (S3, B2, R2...).
2. Wrap that remote in a `crypt` remote, so the dumps are encrypted before they leave the host. Keep its passwords somewhere other than the host.
3. Set `OFFSITE_REMOTE=<crypt remote>:<path>` in `deployment/.env`.
4. Start it with `docker compose ... --profile offsite up -d`.
5. Check it: `OFFSITE_ONCE=1` runs a single copy, and the log shows `offsite ok` / `offsite copy FAILED`.

A backup that only exists on the game host does not survive losing that host.

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
- Encryption of the dumps on the host itself (the off-host copy is encrypted through the rclone crypt remote).
- Periodic automated restore test (restore into a scratch database and compare row counts).
