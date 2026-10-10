#!/bin/sh
# Periodic logical backups of the game database (backup-and-recovery.md).
# Runs in the compose `backup` service (postgres image, so pg_dump matches the server version).
# Each run writes /backups/crusaders-<UTC timestamp>.dump (pg_dump custom format, compressed),
# atomically via a temporary file, then deletes dumps older than BACKUP_KEEP_DAYS.
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
keep_days="${BACKUP_KEEP_DAYS:-7}"

run_backup() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  final="/backups/crusaders-${ts}.dump"
  tmp="/backups/.crusaders-${ts}.dump.part"
  if pg_dump --format=custom --compress=6 --file="$tmp"; then
    mv "$tmp" "$final"
    echo "backup ok: $final ($(wc -c < "$final") bytes)"
  else
    rm -f "$tmp"
    echo "backup FAILED at $ts" >&2
    return 1
  fi
  find /backups -maxdepth 1 -name 'crusaders-*.dump' -mtime +"$keep_days" -print -delete
}

until pg_isready -q; do sleep 2; done

if [ "${BACKUP_ONCE:-0}" = "1" ]; then
  run_backup
  exit $?
fi

while true; do
  run_backup || true
  sleep "$interval"
done
