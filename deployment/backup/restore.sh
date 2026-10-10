#!/bin/sh
# Restores a dump made by backup.sh into the running compose stack (backup-and-recovery.md §3).
# Usage (repository root):  sh deployment/backup/restore.sh deployment/backups/crusaders-<ts>.dump
# The game server is stopped during the restore so no zone writes into a half-restored database;
# characters online at that moment lose progress since the dump.
set -eu

dump="${1:?usage: restore.sh <dump file>}"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }
compose="docker compose -f deployment/docker-compose.yml --env-file deployment/.env"

echo "stopping game server..."
$compose stop server
echo "restoring $dump ..."
# --clean --if-exists drops and recreates every object from the dump in a single transaction.
$compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$dump"
echo "starting game server..."
$compose start server
echo "restore complete"
