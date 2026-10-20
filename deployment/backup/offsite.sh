#!/bin/sh
# Off-host copies of the database dumps (backup-and-recovery.md), in the compose `offsite`
# service (rclone image, `--profile offsite`). Every OFFSITE_INTERVAL_SECONDS it copies the
# finished dumps in /backups (never the .part files being written) to OFFSITE_REMOTE, an rclone
# remote:path from /config/rclone/rclone.conf, and deletes remote dumps older than
# OFFSITE_KEEP_DAYS. Point OFFSITE_REMOTE at an rclone `crypt` remote to encrypt them.
set -eu

remote="${OFFSITE_REMOTE:?set OFFSITE_REMOTE (an rclone remote:path)}"
interval="${OFFSITE_INTERVAL_SECONDS:-3600}"
keep_days="${OFFSITE_KEEP_DAYS:-30}"

run_copy() {
  if rclone copy /backups "$remote" --include 'crusaders-*.dump' --immutable --stats-one-line --stats-log-level NOTICE; then
    echo "offsite ok: $(date -u +%Y%m%dT%H%M%SZ) -> $remote"
  else
    echo "offsite copy FAILED at $(date -u +%Y%m%dT%H%M%SZ)" >&2
    return 1
  fi
  rclone delete "$remote" --include 'crusaders-*.dump' --min-age "${keep_days}d" || true
}

if [ "${OFFSITE_ONCE:-0}" = "1" ]; then
  run_copy
  exit $?
fi

while true; do
  run_copy || true
  sleep "$interval"
done
