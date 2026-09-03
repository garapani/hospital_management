#!/usr/bin/env bash
set -euo pipefail

# Defaults target production: this script's primary real-world use is the nightly cron entry on
# the deployed host (see Deployment-Guide.md "Backup Configuration"), where COMPOSE_FILE/
# POSTGRES_SERVICE are never overridden. docker-compose.prod.yml's Postgres service is named
# `postgres` (container_name hospital-postgres); override both for a local dev-compose test run
# (docker-compose.dev.yml's service is `api-postgres`).
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-hospital_db_user}"
POSTGRES_DB="${POSTGRES_DB:-hospital_db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-postgres-backups}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.dump"

echo "Dumping $POSTGRES_DB from service $POSTGRES_SERVICE (compose file: $COMPOSE_FILE)..."
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$DUMP_FILE"

echo "Validating dump..."
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  pg_restore --list < "$DUMP_FILE" > /dev/null

echo "Compressing..."
gzip -f "$DUMP_FILE"
GZ_FILE="${DUMP_FILE}.gz"

if [ -n "$S3_BUCKET" ]; then
  echo "Uploading to s3://$S3_BUCKET/$S3_PREFIX/$(basename "$GZ_FILE")..."
  aws s3 cp "$GZ_FILE" "s3://$S3_BUCKET/$S3_PREFIX/$(basename "$GZ_FILE")"
else
  echo "S3_BUCKET not set - skipping offsite upload (dry run). Local file: $GZ_FILE"
fi

echo "Pruning local backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -maxdepth 1 -name "${POSTGRES_DB}_*.dump.gz" -mtime "+$RETENTION_DAYS" -delete

echo "Done: $GZ_FILE"
