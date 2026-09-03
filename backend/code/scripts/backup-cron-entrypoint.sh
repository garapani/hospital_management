#!/usr/bin/env bash
set -euo pipefail

# Runs as the `backup` compose service's container process (docker-compose.prod.yml). Unlike
# scripts/backup-db.sh, which drives `docker compose exec` and therefore only works from a shell on
# the host running the compose stack, this connects to Postgres directly over the hospital-network
# (PGHOST=postgres) so the schedule lives inside the stack itself, not an external host cron entry.
# Loops forever, running one backup per day at BACKUP_HOUR_UTC; a failed run is logged and retried
# at the next scheduled time rather than crashing the container (restart: always would otherwise
# turn a transient failure into a restart loop).

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-hospital_db_user}"
POSTGRES_DB="${POSTGRES_DB:-hospital_db}"
export PGPASSWORD="${DB_PASSWORD:?Error: DB_PASSWORD environment variable is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-postgres-backups}"
BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-2}"

run_backup() {
  mkdir -p "$BACKUP_DIR"
  local timestamp dump_file gz_file
  timestamp="$(date -u +%Y%m%d_%H%M%S)"
  dump_file="$BACKUP_DIR/${POSTGRES_DB}_${timestamp}.dump"

  echo "[$(date -u -Iseconds)] Dumping $POSTGRES_DB from $PGHOST:$PGPORT..."
  pg_dump -Fc -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" "$POSTGRES_DB" >"$dump_file"

  echo "Validating dump..."
  pg_restore --list "$dump_file" >/dev/null

  echo "Compressing..."
  gzip -f "$dump_file"
  gz_file="${dump_file}.gz"

  if [ -n "$S3_BUCKET" ]; then
    echo "Uploading to s3://$S3_BUCKET/$S3_PREFIX/$(basename "$gz_file")..."
    aws s3 cp "$gz_file" "s3://$S3_BUCKET/$S3_PREFIX/$(basename "$gz_file")"
  else
    echo "S3_BUCKET not set - skipping offsite upload (dry run). Local file: $gz_file"
  fi

  echo "Pruning local backups older than $RETENTION_DAYS days..."
  find "$BACKUP_DIR" -maxdepth 1 -name "${POSTGRES_DB}_*.dump.gz" -mtime "+$RETENTION_DAYS" -delete

  echo "Done: $gz_file"
}

seconds_until_next_run() {
  local now target
  now="$(date -u +%s)"
  target="$(date -u -d "today ${BACKUP_HOUR_UTC}:00:00" +%s)"
  if [ "$target" -le "$now" ]; then
    target="$(date -u -d "tomorrow ${BACKUP_HOUR_UTC}:00:00" +%s)"
  fi
  echo $((target - now))
}

echo "Backup cron container started. Nightly run at ${BACKUP_HOUR_UTC}:00 UTC, retention ${RETENTION_DAYS}d."
while true; do
  sleep_seconds="$(seconds_until_next_run)"
  echo "Sleeping ${sleep_seconds}s until next run..."
  sleep "$sleep_seconds"
  run_backup || echo "[$(date -u -Iseconds)] Backup run FAILED (see above) - will retry at next scheduled time."
done
