# Runbook

This document provides operational instructions for managing, monitoring, and troubleshooting the Hospital Management System Backend.

## 1. Tenant Provisioning Failures
Tenant isolation is managed via Postgres schemas plus a per-tenant `NOLOGIN` Postgres role. When a
new tenant is created via `POST /tenants`, `TenantsService.provisionTenant()` calls
`TenantProvisioningService.provisionTenantSchema()`, which: creates the `tenant_<id>` schema,
creates the `tenant_<id>` role, grants it schema `USAGE` plus `ALTER DEFAULT PRIVILEGES` on future
tables/sequences, runs `TENANT_MIGRATIONS` against that schema, grants the role explicit access to
the tables/sequences the migrations just created, and grants `tenant_<id>` membership to
`hospital_db_user` (so `SET LOCAL ROLE` can switch into it — see `TenantConnectionService`).

### Symptoms
- 500 Internal Server Errors when a specific tenant tries to log in or use the API.
- Logs indicating: `relation "orders" does not exist` or `schema "tenant_<id>" does not exist`.
- `permission denied for schema tenant_<id>` — the role/grant half of provisioning didn't complete.

### Resolution
1. Verify if the tenant schema was actually created in the DB:
   ```sql
   SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_XYZ';
   ```
2. Verify the role exists and has the expected grants:
   ```sql
   SELECT rolname FROM pg_roles WHERE rolname = 'tenant_XYZ';
   SELECT * FROM information_schema.role_table_grants WHERE table_schema = 'tenant_XYZ';
   ```
3. If schema, role, or grants are missing or incomplete, provisioning failed midway —
   `provisionTenantSchema()` is not currently retried/resumed automatically (see the code comment
   on `TenantsService.provisionTenant()`). Check the API logs for the failing step, then either
   manually complete the missing piece (schema/role/grants/migrations) or drop the schema and role
   and re-provision the tenant from scratch.

### Deploying a new tenant migration
Adding a file to `TENANT_MIGRATIONS` only changes what a *newly* provisioned tenant gets — it does
not reach any tenant schema that already exists. **After deploying a tenant migration, run
`pnpm exec nx run api:migrate-tenants` (or, in prod, `docker compose -f docker-compose.prod.yml run
--rm migrate`, which runs `migrate.ts` then `migrate-tenants.ts`) against every environment that
has existing tenant data — dev, staging, and prod each need their own run.** Forgetting this step is
silent: the app boots fine and only fails per-query, per-tenant, at the point something touches the
missing column/table. This exact gap shipped on 2026-08-23 (migration 0057 added
`accounts.patientId`, `migrate-tenants` was never re-run against the already-provisioned `demo`,
`demo1`, and `__platform` schemas) and took down login everywhere, because
`AuthService.login`'s anti-enumeration catch folded the underlying `column Account.patientId does
not exist` error into a generic "Invalid username or password" 401. The
`migrate-tenants-backfill.integration-spec.ts` gate (`apps/api/src/database/`) exists to catch a
regression in the backfill mechanism itself in CI, but it cannot force the deploy-time command to
actually be run — treat this as a mandatory manual step in the deploy checklist, not optional.

## 2. Event Archiver and Audit Logs Missing
We use asynchronous TypeORM `EntitySubscriberInterface` hooks to capture Audit Logs and Reporting Events without blocking the core business transaction.

### Symptoms
- Actions occur, but no records appear in `audit_records` or `reporting_events`.
- In test environments: "Jest did not exit one second after the test run has completed."

### Resolution
1. **Check Logs for Publisher Errors**:
   `PersistingAuditEventPublisher`/`PersistingReportingEventPublisher` wrap the actual write in a
   `try/catch` and only `logger.error(...)` on failure — they never crash the triggering request.
   Inspect the application logs for `[PersistingAuditEventPublisher]` or
   `[PersistingReportingEventPublisher]` errors.
2. **How persistence actually happens**: `AuditSubscriber`'s `afterInsert`/`afterUpdate`/`afterRemove`
   hooks call the publisher synchronously with the `EntityManager` TypeORM's subscriber API hands
   them (`event.manager`) — so the audit/reporting write runs inside the *same* transaction as the
   business write that triggered it, not deferred to a commit hook (there is no
   `afterTransactionCommit` anywhere in this codebase). If the business transaction rolls back, the
   audit/reporting write rolls back with it. The one path that opens its own connection is
   `PersistingAuditEventPublisher.publish()` when called without a manager — it uses
   `TenantConnectionService.runInTenantSchema()`, which runs the whole callback inside a real
   transaction with `SET LOCAL ROLE`/`SET LOCAL search_path` already applied, so schema mismatches
   there point at a tenant-context bug, not a stale connection.

## 3. Dealing with Test Flakiness (inTenant utility)
`inTenant()` (from `apps/api/src/testing/tenant-test-context.ts`) is **not** a rolled-back
transaction wrapper — it runs the callback inside `TenantContextService.run({ tenantId, ... }, work)`,
which just sets `AsyncLocalStorage` context for the duration of `work`. Each test's schema/role is
created for real by `TenantProvisioningService` in `setupTenantTestContext()` and dropped in
`teardownTenantTestContext()`; there is no per-test rollback.

### Symptoms
- `relation "..." does not exist` from a test that expects an earlier test's data — usually a
  missing/wrong `namePrefix` causing two tests to collide on the same tenant id, or a schema/role
  that a prior crashed run left behind (both `setupTenantTestContext`/`provisionTenant` handle the
  latter by dropping any existing schema/role before provisioning).
- `role "tenant_<id>" already exists` / `schema "tenant_<id>" already exists` on a suite rerun — a
  prior run's `afterAll` didn't drop the schema/role (check the spec's `afterAll` does
  `DROP SCHEMA ... CASCADE` + `DROP ROLE` for every tenant id it created, not just
  `teardownTenantTestContext(ctx)` for the primary one — several specs create additional tenants
  directly and need their own cleanup).

### Resolution
- Confirm the failing spec's `afterAll` cleans up every tenant schema/role it created, including
  ones constructed via `ctx.createTenant()` or a directly-instantiated `TenantsService`/
  `TenantProvisioningService`, not just the one `setupTenantTestContext()` returns.
- If asserting on data written by an audit/reporting subscriber, remember the write happens inside
  the same transaction as the triggering action (see Section 2) — no need to wait for a separate
  commit hook.

## 4. Resetting the Environment
If your local development database gets corrupted:
```bash
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
npx nx serve api
```
This drops the volume and restarts Postgres with a clean slate.

## 5. Restoring from Backup

Backups are nightly `pg_dump -Fc` files produced by `scripts/backup-db.sh` (see
`Deployment-Guide.md` "Backup Configuration"), uploaded to the configured S3 bucket. **Default
RPO: up to 24 hours of data loss** on the nightly-dump path alone. Continuous WAL archiving
narrows this to minutes when enabled — see "Continuous WAL Archiving / Point-in-Time Recovery"
below; it is **opt-in, not yet turned on in any deployed environment**, so treat 24h as the actual
RPO until it's enabled and drilled at least once.

### Full-database restore

```bash
aws s3 cp s3://$S3_BUCKET/$S3_PREFIX/<filename>.dump.gz ./restore.dump.gz
gunzip ./restore.dump.gz
docker compose -f docker-compose.dev.yml exec -T api-postgres \
  pg_restore -U hospital_db_user -d hospital_db --clean --if-exists < ./restore.dump
```
`--clean --if-exists` drops existing objects before recreating them, so this is safe to run
against a database that already has stale or corrupt data in it.

### Per-tenant schema restore

Restores exactly one tenant's schema without touching any other tenant or the platform's `public`
schema:
```bash
docker compose -f docker-compose.dev.yml exec -T api-postgres \
  pg_restore -U hospital_db_user -d hospital_db --schema=tenant_<hospitalId> --clean --if-exists < ./restore.dump
```

### Monthly restore-drill procedure

Once a month, prove a real backup actually restores:
1. Restore the latest dump into a scratch database:
   ```bash
   docker compose -f docker-compose.dev.yml exec -T api-postgres createdb -U hospital_db_user restore_drill_scratch
   docker compose -f docker-compose.dev.yml exec -T api-postgres \
     pg_restore -U hospital_db_user -d restore_drill_scratch --clean --if-exists < ./restore.dump
   ```
2. Run smoke queries confirming non-zero row counts on both a platform table and at least one
   tenant schema:
   ```bash
   docker compose -f docker-compose.dev.yml exec -T api-postgres \
     psql -U hospital_db_user -d restore_drill_scratch -c "SELECT count(*) FROM public.tenants;"
   docker compose -f docker-compose.dev.yml exec -T api-postgres \
     psql -U hospital_db_user -d restore_drill_scratch -c "SELECT count(*) FROM tenant_<any-known-tenant-id>.patients;"
   ```
3. Drop the scratch database:
   ```bash
   docker compose -f docker-compose.dev.yml exec -T api-postgres dropdb -U hospital_db_user restore_drill_scratch
   ```
4. Log the result below.

**Drill log:**

| Date | Dump used (filename/date) | Result | Notes |
|---|---|---|---|
| _(fill in after first drill)_ | | | |

### Continuous WAL Archiving / Point-in-Time Recovery (PITR)

**Status: documented procedure, opt-in — not enabled in any deployed environment today.**
Nightly `pg_dump` alone caps RPO at 24h; enabling WAL archiving lets you replay every committed
transaction up to (or just before) the moment of failure instead of losing up to a day of data.
This is additive to the nightly dumps, not a replacement — the dumps remain the PITR base backup's
fallback if the WAL archive itself is lost or corrupted.

**Enabling archiving** (both `docker-compose.dev.yml`'s `api-postgres` and
`docker-compose.prod.yml`'s `postgres` run `postgres:16`/`postgres:16-alpine` with a bind-mounted
data volume — add a second bind mount for the archive directory):

1. Add an archive volume to the Postgres service, e.g. `- ./.data/wal-archive:/wal-archive` (dev)
   or a dedicated volume in prod.
2. Set these in `postgresql.conf` (or via `command:`/a mounted `postgresql.conf` override —
   whichever the compose file already uses for Postgres config; there is none today, so this is a
   net-new mount):
   ```
   wal_level = replica
   archive_mode = on
   archive_command = 'test ! -f /wal-archive/%f && cp %p /wal-archive/%f'
   archive_timeout = 300
   ```
   `archive_timeout = 300` forces a WAL segment switch at least every 5 minutes even under low
   write volume, bounding RPO to ~5 minutes instead of depending entirely on segment fill rate.
3. Restart the Postgres container so the config takes effect (`archive_mode` requires a restart,
   not just a reload).
4. Take a fresh base backup once archiving is confirmed running (check `archive_command` is
   succeeding — no `.ready` files piling up in `pg_wal/archive_status/` inside the container):
   ```bash
   docker compose -f docker-compose.dev.yml exec api-postgres \
     pg_basebackup -U hospital_db_user -D /wal-archive/base/$(date +%Y%m%d) -Fp -Xs -P
   ```
5. Periodically ship `/wal-archive` offsite (same S3 target `backup-db.sh` already uploads to,
   under its own `S3_PREFIX` e.g. `wal-archive`) — a local-only archive volume defeats the purpose
   if the host itself is lost (see "Hardware Failure Recovery" below).

**Restoring to a point in time:**

1. Restore the most recent base backup's data directory into a fresh Postgres data volume.
2. Drop a `recovery.signal` file (empty file, PG16+) into that data directory — its mere presence
   is what puts Postgres into recovery mode; there is no separate `recovery.conf` in PG12+.
3. Set in `postgresql.conf` (or `postgresql.auto.conf`) on the restored instance:
   ```
   restore_command = 'cp /wal-archive/%f %p'
   recovery_target_time = '2026-08-25 14:30:00+00'
   ```
   Omit `recovery_target_time` to replay every archived WAL segment (recover to the latest
   available point); set it to stop replay at a specific timestamp — e.g. just before a bad
   migration or an accidental mass-delete.
4. Start Postgres. It replays WAL from `restore_command` until it reaches `recovery_target_time`
   (or runs out of WAL), then promotes to a normal read-write instance and renames
   `recovery.signal` away automatically.
5. Run the same restore-drill smoke queries from "Monthly restore-drill procedure" above to confirm
   data is present and consistent before treating the instance as authoritative.

**Not yet done:** this procedure has not been exercised end-to-end against a real deployment —
treat it as a documented starting point, not a validated runbook, until it's been drilled at least
once the way the nightly-dump restore already is.

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

### Self-owned-server variant

Scope: if `PRD.md` §12 open question #1 resolves toward a **self-owned server** (colo/on-prem)
instead of a VPS. The steps above assume a VPS provider that can snapshot or reprovision an
instance in minutes; none of that exists for physical hardware, so the procedure differs in the
ways that matter for RTO:

1. **No provider-level snapshot/reprovision step.** Step 1 above ("restore from a VPS snapshot or
   provision a new VPS instance") is replaced by either: swapping in cold-spare hardware already
   racked and powered (if one is kept on hand) or physically sourcing/installing replacement
   hardware — the latter can take from hours to days depending on parts availability, and blows
   through the ~4h RTO target the VPS path assumes. **A cold spare (or a documented decision to
   accept a longer RTO) is a prerequisite for self-owned hosting to hit any RTO target at all** —
   this is not optional infrastructure, it's the load-bearing assumption behind step 1.
2. **Network/power are now your dependency, not the provider's.** Confirm whether the failure is
   the server itself vs. upstream power/network/cooling at the facility before starting hardware
   recovery — a self-owned box has no automatic failover to a different physical location the way
   a VPS provider's infrastructure might.
3. **OS + Docker install is no longer a provider base image.** Step 2 ("Install Docker + Docker
   Compose on the new instance") now also needs a documented base-OS provisioning step (which
   distro/version, disk partitioning, network config) — none of this is captured yet because no
   self-owned server exists today. Treat this as the first thing to document once hardware is
   actually chosen, not something this runbook can specify in the abstract.
4. **DNS cutover (step 7) is unchanged** — it's provider-agnostic either way.
5. **Steps 3–6 (clone repo, bring up compose stack, restore backup, run smoke queries) are
   unchanged** from the VPS path once the replacement hardware is up and reachable.

This subsection is a placeholder for the operational differences, not a complete self-owned
runbook — it cannot be made complete until the self-owned-vs-VPS decision in `PRD.md` §12 is
actually made and real hardware/facility details exist to document against.

### Owner and escalation

_(Placeholder — fill in the actual on-call owner/escalation contact for this procedure. Not
something this runbook can supply on its own. Explicitly deferred as of 2026-08-25 — asked, human
chose to leave it open rather than name someone yet.)_

## 7. Object Storage Backup Policy

**Status: documented policy only — no implementing script yet.** There is currently no domain
module writing real objects to MinIO (see `Development-Standards.md` §13), so there is nothing to
back up today. This section exists so the policy doesn't have to be invented later under time
pressure once a real writer (e.g. DICOM in Phase 2, reporting exports in Phase 6) lands.

**Policy, once a real writer exists:**

1. Enable bucket versioning on the shared `hospital-objects` bucket (`mc version enable`), so an
   overwritten or deleted object stays recoverable.
2. Run a periodic `mc mirror` job from the `hospital-objects` bucket to the same offsite
   S3-compatible target `scripts/backup-db.sh` already uploads Postgres dumps to (`S3_BUCKET`/
   `S3_PREFIX` env vars, see `Deployment-Guide.md` "Backup Configuration") — a separate
   `S3_PREFIX` (e.g. `object-storage-backups`) keeps it from colliding with the Postgres dump
   prefix in the same bucket.
3. Apply the same 30-day retention lifecycle rule used for Postgres backups (`Deployment-Guide.md`
   §"Configure a bucket lifecycle rule expiring objects... after 30 days").

**Not yet decided:** cron schedule and frequency for the mirror job — likely nightly, alongside
`backup-db.sh`, but not fixed until real object volume exists to size it against.
