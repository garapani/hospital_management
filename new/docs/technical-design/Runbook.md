# Runbook

This document provides operational instructions for managing, monitoring, and troubleshooting the Hospital Management System Backend.

## 1. Tenant Provisioning Failures
Tenant isolation is managed via Postgres schemas plus a per-tenant `NOLOGIN` Postgres role. When a
new tenant is created via `POST /tenants`, `TenantsService.provisionTenant()` calls
`TenantProvisioningService.provisionTenantSchema()`, which: creates the `tenant_<id>` schema,
creates the `tenant_<id>` role, grants it schema `USAGE` plus `ALTER DEFAULT PRIVILEGES` on future
tables/sequences, runs `TENANT_MIGRATIONS` against that schema, grants the role explicit access to
the tables/sequences the migrations just created, and grants `tenant_<id>` membership to
`identity_access` (so `SET LOCAL ROLE` can switch into it — see `TenantConnectionService`).

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
