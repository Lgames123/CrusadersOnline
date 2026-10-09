# Backup and Disaster Recovery: PostgreSQL Schedules & Restoration

## 1. Automated Backup Policy

| Backup Type | Frequency | Retention | Storage Target |
|---|---|---|---|
| **WAL Archiving** | Continuous (Every 16MB segment) | 7 Days | S3 / MinIO Encrypted Bucket |
| **Full Logical Dump (`pg_dump`)** | Daily at 03:00 UTC | 30 Days | Offsite Object Storage |
| **Character State Snapshot** | Hourly | 48 Hours | Local Secondary Volume |

---

## 2. Daily Backup Script
```bash
#!/bin/bash
# scripts/backup_db.sh
set -e
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="/backups/crusaders_db_${TIMESTAMP}.sql.gz"

echo "[*] Creating database dump: ${BACKUP_FILE}"
pg_dump -h db -U crusaders_admin -d crusaders_online | gzip > "${BACKUP_FILE}"
echo "[+] Backup successfully created."
```

---

## 3. Disaster Recovery Restoration Procedure

```bash
# 1. Stop the game server to prevent incoming writes
docker compose stop server

# 2. Restore database from snapshot
gunzip -c /backups/crusaders_db_20261009_030000.sql.gz | psql -h db -U crusaders_admin -d crusaders_online

# 3. Restart game server and verify integrity
docker compose start server
```
