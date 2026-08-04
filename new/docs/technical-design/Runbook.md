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
