# Backup/Restore Runbooks + Hardware Failure Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give this repo a real, runnable nightly backup script plus the operational
documentation (backup setup, restore procedures, hardware-failure recovery) that
`new-features.md` #6 and #7 ask for and that doesn't exist today.

**Architecture:** One new shell script (`scripts/backup-db.sh`) that dumps the whole Postgres
database via `docker compose exec`, validates, compresses, and optionally uploads it to S3. Two
docs files gain new sections: `Deployment-Guide.md` (how to configure backups) and `Runbook.md`
(how to restore, and how to recover from a VPS hardware failure).

**Tech Stack:** Bash, `docker compose exec` (no host-side Postgres client tools needed), `aws-cli`
for the optional S3 upload, `gzip`.

## Global Constraints

- **Scope: Hostinger VPS hardware-recovery path only.** Not the self-owned-server path — `PRD.md`
  §12 open question #1 is still unresolved, and the human partner directed this item at the
  interim VPS reality, not the undecided long-term target.
- **Backup mechanism: nightly `pg_dump -Fc` only.** No continuous WAL archiving/point-in-time
  recovery — that's a deferred follow-up. **RPO is up to 24 hours of data loss**, stated explicitly
  in the runbook, not hidden.
- **Offsite target: S3-compatible object storage, India region** (data-residency requirement,
  `PRD.md` §10).
- **Retention: 30 days**, enforced two ways — an S3 bucket lifecycle rule for the offsite copies,
  and the script's own local `find -mtime` cleanup for its working directory. These are two
  independent mechanisms that happen to share the same number; changing retention means updating
  both.
- **Target RTO for hardware-failure recovery: ~4 hours.**
- **No automated test.** Per the human partner's standing instruction this session, this task's
  verification is manual (see Task 1) — no Jest suite applies to a shell script anyway.
- **Owner/escalation contact is an explicit placeholder** in the runbook — not something to invent.

---

### Task 1: `scripts/backup-db.sh`

**Files:**
- Create: `new/code/scripts/backup-db.sh`

**Interfaces:**
- Produces: an executable script invoked as `./scripts/backup-db.sh` from `new/code`, configured
  entirely via environment variables (`COMPOSE_FILE`, `POSTGRES_SERVICE`, `POSTGRES_USER`,
  `POSTGRES_DB`, `BACKUP_DIR`, `RETENTION_DAYS`, `S3_BUCKET`, `S3_PREFIX`) — Task 2's
  Deployment-Guide.md documentation references these exact names.

- [ ] **Step 1: Create the `scripts` directory and write the script**

`new/code/scripts/backup-db.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-api-postgres}"
POSTGRES_USER="${POSTGRES_USER:-identity_access}"
POSTGRES_DB="${POSTGRES_DB:-identity_access}"
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
  pg_restore --list - < "$DUMP_FILE" > /dev/null

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
```

Validation deliberately runs `pg_restore --list` **inside the Postgres container** (piping the
dump into `docker compose exec -T ... pg_restore --list -` via stdin) rather than assuming the
host machine has Postgres client tools installed — the script's only host-side dependencies are
`docker`, `gzip`, `find`, `date`, and `aws` (only when `S3_BUCKET` is set). This matches how
Task 2's restore procedures also run `pg_restore` inside the container, never on the bare host.

- [ ] **Step 2: Make it executable**

```bash
chmod +x new/code/scripts/backup-db.sh
```

- [ ] **Step 3: Manual verification — dry run against the local dev stack**

```bash
cd new/code
docker-compose -f docker-compose.dev.yml up -d
./scripts/backup-db.sh
```
Expected output ends with:
```
S3_BUCKET not set - skipping offsite upload (dry run). Local file: ./backups/identity_access_<timestamp>.dump.gz
Pruning local backups older than 30 days...
Done: ./backups/identity_access_<timestamp>.dump.gz
```
Then confirm the file is a valid, listable `pg_dump -Fc` archive:
```bash
gunzip -k ./backups/identity_access_<timestamp>.dump.gz
docker compose -f docker-compose.dev.yml exec -T api-postgres \
  pg_restore --list - < ./backups/identity_access_<timestamp>.dump
```
Expected: a table-of-contents listing (schemas, tables, sequences) with no error — confirms the
dump is valid and restorable, independent of the script's own internal validation step. Delete the
local `./backups/` directory afterward (it's a manual test artifact, not something to commit).

- [ ] **Step 4: Commit**

```bash
git add new/code/scripts/backup-db.sh
git commit -m "feat(ops): add nightly Postgres backup script"
```

---

### Task 2: Documentation

**Files:**
- Modify: `new/docs/technical-design/Deployment-Guide.md`
- Modify: `new/docs/technical-design/Runbook.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- Consumes: the env var names from Task 1 (`COMPOSE_FILE`, `POSTGRES_SERVICE`, `POSTGRES_USER`,
  `POSTGRES_DB`, `BACKUP_DIR`, `RETENTION_DAYS`, `S3_BUCKET`, `S3_PREFIX`) and the script path
  `new/code/scripts/backup-db.sh`.

- [ ] **Step 1: Add "Backup Configuration" to Deployment-Guide.md**

`Deployment-Guide.md` currently ends with:
```markdown
## 7. Scaling
Since the app is stateless (all state is in Postgres/Redis), you can scale the API horizontally by running multiple instances behind a reverse proxy (e.g., Nginx, AWS ALB). Ensure your Redis instance (Phase 5) is shared across all nodes for rate-limiting.
```
Append:
```markdown

## 8. Backup Configuration

Nightly backups run via `scripts/backup-db.sh`, which `pg_dump`s the whole database (every tenant
schema plus `public`, since it's all one Postgres database) into one custom-format (`-Fc`) file,
validates it, gzips it, and uploads it to an S3-compatible bucket. See `Runbook.md` "Restoring
from Backup" for how to use the resulting dump. **RPO is up to 24 hours** — backups are nightly
only; there is no continuous WAL archiving/point-in-time recovery yet (a known, deliberately
deferred gap, not an oversight).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `COMPOSE_FILE` | `docker-compose.dev.yml` | Compose file the Postgres service lives in — **update this once a production `docker-compose.yml` exists** (tracked gap, see `pending-tasks.md`'s dependencies section). |
| `POSTGRES_SERVICE` | `api-postgres` | Compose service name to `docker exec` into. |
| `POSTGRES_USER` | `identity_access` | Matches `DB_USERNAME`. |
| `POSTGRES_DB` | `identity_access` | Matches `DB_DATABASE`. |
| `BACKUP_DIR` | `./backups` | Local working directory for dump files before/after upload. |
| `RETENTION_DAYS` | `30` | Local dump files older than this are deleted after a successful run. |
| `S3_BUCKET` | *(unset)* | Target bucket. **If unset, the script runs in dry-run mode** — it still dumps, validates, and gzips locally, but skips the upload step and logs a warning instead. |
| `S3_PREFIX` | `postgres-backups` | Key prefix inside the bucket. |

### One-time setup

1. Create an S3-compatible bucket in an India region (e.g. AWS S3 `ap-south-1`) — required by
   `PRD.md` §10's data-residency rule.
2. Configure a bucket lifecycle rule expiring objects under `S3_PREFIX` after 30 days (matches
   `RETENTION_DAYS`) — this is what actually prunes the *offsite* copies; the script only prunes
   its own local working directory. Both use the same 30-day figure but are two independent
   mechanisms — change both if the retention window changes.
3. Provide AWS credentials with write access to that bucket via the standard `aws-cli` credential
   chain (env vars, `~/.aws/credentials`, or an instance role) — not through this repo's `.env`
   file, since that's for the application's own runtime config, not ops tooling credentials.
4. Add a nightly cron entry on the host running the compose stack:
   ```cron
   0 2 * * * cd /path/to/new_hospital/new/code && S3_BUCKET=your-bucket-name ./scripts/backup-db.sh >> /var/log/backup-db.log 2>&1
   ```
```

- [ ] **Step 2: Add "Restoring from Backup" and "Hardware Failure Recovery" to Runbook.md**

`Runbook.md` currently ends with:
```markdown
## 4. Resetting the Environment
If your local development database gets corrupted:
```bash
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
npx nx serve api
```
This drops the volume and restarts Postgres with a clean slate.
```
Append:
```markdown

## 5. Restoring from Backup

Backups are nightly `pg_dump -Fc` files produced by `scripts/backup-db.sh` (see
`Deployment-Guide.md` "Backup Configuration"), uploaded to the configured S3 bucket. **RPO: up to
24 hours of data loss** — backups are nightly only, no continuous WAL archiving/point-in-time
recovery exists yet (tracked as a known gap, not solved by this runbook).

### Full-database restore

```bash
aws s3 cp s3://$S3_BUCKET/$S3_PREFIX/<filename>.dump.gz ./restore.dump.gz
gunzip ./restore.dump.gz
docker compose -f docker-compose.dev.yml exec -T api-postgres \
  pg_restore -U identity_access -d identity_access --clean --if-exists < ./restore.dump
```
`--clean --if-exists` drops existing objects before recreating them, so this is safe to run
against a database that already has stale or corrupt data in it.

### Per-tenant schema restore

Restores exactly one tenant's schema without touching any other tenant or the platform's `public`
schema:
```bash
docker compose -f docker-compose.dev.yml exec -T api-postgres \
  pg_restore -U identity_access -d identity_access --schema=tenant_<hospitalId> --clean --if-exists < ./restore.dump
```

### Monthly restore-drill procedure

Once a month, prove a real backup actually restores:
1. Restore the latest dump into a scratch database:
   ```bash
   docker compose -f docker-compose.dev.yml exec -T api-postgres createdb -U identity_access restore_drill_scratch
   docker compose -f docker-compose.dev.yml exec -T api-postgres \
     pg_restore -U identity_access -d restore_drill_scratch --clean --if-exists < ./restore.dump
   ```
2. Run smoke queries confirming non-zero row counts on both a platform table and at least one
   tenant schema:
   ```bash
   docker compose -f docker-compose.dev.yml exec -T api-postgres \
     psql -U identity_access -d restore_drill_scratch -c "SELECT count(*) FROM public.tenants;"
   docker compose -f docker-compose.dev.yml exec -T api-postgres \
     psql -U identity_access -d restore_drill_scratch -c "SELECT count(*) FROM tenant_<any-known-tenant-id>.patients;"
   ```
3. Drop the scratch database:
   ```bash
   docker compose -f docker-compose.dev.yml exec -T api-postgres dropdb -U identity_access restore_drill_scratch
   ```
4. Log the result below.

**Drill log:**

| Date | Dump used (filename/date) | Result | Notes |
|---|---|---|---|
| _(fill in after first drill)_ | | | |

## 6. Hardware Failure Recovery

Scope: the **Hostinger VPS** hosting path. `PRD.md` §12 open question #1 (self-owned server vs.
VPS) is still unresolved — this runbook covers what's actually deployed today. If the self-owned
direction is finalized later, this section needs a follow-up rewrite, not a patch.

**Target RTO: ~4 hours.**

### Recovery steps

1. Provision a replacement: either restore from a recent Hostinger-level VPS snapshot if one
   exists and is fresh enough, or provision a new VPS instance from scratch.
2. Install Docker + Docker Compose on the new instance.
3. Clone the repo (`new_hospital`) and check out the commit currently running in production (tag
   or note this as part of your deploy process — not yet formalized; see `pending-tasks.md`'s
   tracked production-infra gap).
4. Bring up the compose stack: `docker compose -f docker-compose.dev.yml up -d` (update this once
   a production compose file exists).
5. Pull the latest dump from S3 and restore it (see "Restoring from Backup" above) — accept the
   RPO stated there (up to 24h of data since the last nightly backup).
6. Run the restore-drill smoke queries above against the now-live database to confirm the restore
   is good before cutting traffic over.
7. Cut DNS over: update the A record for the production hostname to the new VPS's IP. TTL and the
   specific DNS provider/registrar are host-specific — fill in against whatever is actually in use
   once that's decided (not yet documented anywhere in this repo).
8. Monitor error logs/health after cutover for any residual issues.

### Owner and escalation

_(Placeholder — fill in the actual on-call owner/escalation contact for this procedure. Not
something this runbook can supply on its own.)_
```

- [ ] **Step 3: Check off `pending-tasks.md` Phase 3 item 8**

The line currently reads:
```markdown
8. **Backup/restore runbooks** (new-features.md #6) **+ hardware failure recovery plan**
   (new-features.md #7) — pure ops docs, no code dependency, can run in parallel with anything
   above, but must land before any real launch (data loss = compliance issue).
```
Replace with:
```markdown
8. [x] **Backup/restore runbooks** (new-features.md #6) **+ hardware failure recovery plan**
   (new-features.md #7) — done: `scripts/backup-db.sh` (nightly `pg_dump -Fc`, S3-compatible
   India-region offsite target, 30-day retention), full + per-tenant restore procedures and a
   monthly restore-drill procedure in `Runbook.md`, and a Hostinger-VPS-path hardware-failure
   recovery runbook (~4h target RTO). Scoped to the VPS hosting path only — `PRD.md` §12 open
   question #1 (self-owned server vs. VPS) is still unresolved. **Not done:** continuous WAL/PITR
   (24h RPO accepted instead), a self-owned-server recovery runbook, and naming a real
   owner/escalation contact (left as an explicit placeholder).
```

- [ ] **Step 4: Commit**

```bash
git add new/docs/technical-design/Deployment-Guide.md new/docs/technical-design/Runbook.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: add backup/restore and hardware-failure recovery runbooks"
```
