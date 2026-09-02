# Technical Design & Architecture — Hospital EMR Backend (vaidya)

> Quick-understanding architecture doc. For the exhaustive per-module/code map see
> [`Module-Reference.md`](./Module-Reference.md). Deployment/ops depth lives in
> [`Deployment-Guide.md`](./Deployment-Guide.md) and [`Runbook.md`](./Runbook.md).
> Product scope/phasing: [`PRD.md`](./PRD.md). Conventions: `../../code/CLAUDE.md` and
> [`Development-Standards.md`](./Development-Standards.md).

## 1. System summary

A **NestJS 11 modular monolith** (Nx 23 workspace, pnpm) that re-platforms the legacy Danphe EMR
hospital system for the India hospital market. One deployable API (`apps/api`) containing ~40
tightly encapsulated feature modules, sharing **PostgreSQL 16** (TypeORM), **Redis** (rate
limiting), and **MinIO** (object storage). Multi-tenant: each hospital tenant gets its **own
Postgres schema**, enforced natively at the database layer (no `tenantId` threaded through every
WHERE clause).

```text
                        ┌──────────────────────────────────────────────────────────┐
 Hospital clients ─────►│  apps/api  (vaidya API, global prefix /api)               │
 (staff-console SPA,    │                                                            │
  platform console,     │  AuthContextMiddleware ─► TenantContextMiddleware ─► metrics│
  patient portal,       │  ThrottlerGuard (APP_GUARD)                                 │
  integrations)         │                                                            │
                        │  ┌────────────────────────────────────────────────────┐    │
                        │  │ feature modules (billing, lab, patients, ... ~40)  │    │
                        │  │   controllers → services → TypeORM entities        │    │
                        │  └────────────────────────────────────────────────────┘    │
                        │  cross-cutting: audit (lifecycle hooks), reporting events, │
                        │  observability, @hospital/* shared libs                    │
                        └───────┬───────────────┬────────────────┬───────────────────┘
                                │               │                │
                     PostgreSQL 16        Redis (throttle)    MinIO (objects)
                     schema per tenant     (dev: port 6380)
```

Two operational tiers live in the same API:

- **Platform (superadmin) tier** — `accounts`, `tenants` (provision/purge), `platform-billing`
  (tenant subscriptions), `platform-branding`, `packages` (catalog), `rbac` role/permission
  management, cross-tenant `auth`. Fronted by the platform console on the `admin` subdomain.
- **Tenant tier** — every clinical/finance/operations module, scoped to the caller's tenant
  schema via the tenant context.

## 2. Design principles

- **Modular monolith over microservices** — bounded contexts as Nest modules in one process;
  shared DB; modules communicate by direct service calls and (for audit/reporting/notifications)
  TypeORM lifecycle events + domain-event publishing.
- **Tenant isolation at the database, not the query layer** — `SET search_path` per connection
  checkout (see §4). New modules get tenant scoping for free.
- **Permission-driven API surface** — every protected route declares required permissions
  (`@RequirePermissions` → `PermissionGuard`); the permission catalog is seeded, not ad hoc.
- **Auditability & PHI care** — structural mutations are captured by audit lifecycle hooks;
  clinical sign-off fields and money (Billing/Accounting/Payroll/Insurance) get the heaviest test
  rigor.
- **Cross-cutting utilities as `@hospital/*` libs** — pagination, Excel, PDF, object storage,
  observability, tenant context, auth guards, audit emitter; reused by any module.
- **Facts encoded in code comments** — this codebase deliberately carries detailed "why" comments
  (e.g. the throttler configuration history in `apps/api/src/app/app.module.ts`); treat those as
  authoritative design records.

## 3. Request lifecycle

Middleware registration (`apps/api/src/app/app.module.ts`, `AppModule.configure`):

1. **`AuthContextMiddleware`** (`@hospital/auth-guards`) — applied to `*` **except**
   `UNAUTHENTICATED_ROUTES` (`libs/tenant-context/src/lib/unauthenticated-routes.ts`):
   `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/change-password`,
   `GET /api/metrics`, `GET /api/branding`. Verifies the JWT and populates `req.authContext`
   (user, roles, permissions, tenant).
2. **`TenantContextMiddleware`** (`@hospital/tenant-context`) — resolves the tenant (platform vs
   `tenant_<id>` schema) and binds it into the `AsyncLocalStorage` tenant context used by the
   connection pool.
3. **`metricsMiddleware`** (`@hospital/observability`) — times the request; reads
   `req.authContext` and `req.route`.
4. **`ThrottlerGuard`** (global `APP_GUARD`) — Redis-backed, default **100 req/min** per client;
   auth routes override tighter per-route via `@Throttle`. Under `NODE_ENV=test` storage is
   in-memory per app instance.

Then: controller → service → TypeORM (schema-scoped connection) → response. Mutations pass
through TypeORM lifecycle hooks that feed **audit** (§7) and, for business-critical operations,
the **reporting event archiver** (§7). Validation is global via the `ValidationPipe` + an
API validation pipe (`apps/api/src/app/api-validation-pipe.ts`); Swagger UI is served at
`/api/docs`.

## 4. Tenant isolation

- Each hospital tenant owns a Postgres **schema and NOLOGIN role**, both named `tenant_<id>`;
  platform data lives in the `public` schema (reserved platform tenant `__platform`). Tenant
  provisioning (`tenants` module + `apps/api/src/database/tenant-provisioning.service.ts`) creates
  the schema/role, runs every tenant migration against it, seeds the chart of accounts, then
  grants table/sequence privileges.
- Tenant-scoped data access goes through
  `TenantConnectionService.runInTenantSchema(work)`
  (`apps/api/src/database/tenant-connection.service.ts`): it checks out a `QueryRunner`, starts a
  transaction, and issues `SET LOCAL ROLE "tenant_<id>"` + `SET LOCAL search_path TO
  "tenant_<id>", public` before running the work. Because `SET LOCAL` is **transaction-scoped**, a
  pooled connection can never leak another tenant's role/`search_path` into the next request.
  `@hospital/tenant-context` carries the request's `{tenantId, accountId, patientId, wardId,
  correlationId}` in `AsyncLocalStorage`; module code never filters by tenant id manually —
  isolation is structural.
- Entity conventions: business/clinical/financial entities extend `AuditableEntity` /
  `SoftDeletableEntity` (`apps/api/src/database/auditable.entity.ts`); `AuditColumnsSubscriber`
  fills `createdBy/updatedBy/deletedBy` from the tenant context.
- Migrations: numbered files under `apps/api/src/database/migrations/` — two immutable baselines
  (`0093-initial-platform-schema` run by `migrate.ts`; `0094-initial-tenant-schema` + per-feature
  appends run per tenant at provisioning and by `migrate-tenants.ts`). History 0001–0092 was
  squashed into the baselines on 2026-08-27.
- Integration specs assert isolation invariants (`public-schema-purity.integration-spec.ts`,
  `tenant-context-interop.spec.ts`, plus per-module `TenantTestContext`-based specs under
  `apps/api/src/testing/`).

## 5. Auth & authorization

- **`AuthModule`** (`auth/`) — JWT issue/refresh/change-password; cross-tenant login is supported
  (accounts exist per tenant, plus platform accounts). Endpoints: `POST /api/auth/login`,
  `POST /api/auth/refresh`, `POST /api/auth/change-password`.
- **Claims & permissions** — the access token embeds user identity, roles and permission codes
  (`sub`, `hospitalId`, `roles`, `permissions`, `type: 'access'`, `accountType`, optional
  `patientId`/`wardId`, staff `displayName` — see `auth/auth.service.ts` `buildAccessPayload` and
  `libs/auth-guards/src/lib/auth-context.middleware.ts`). RBAC catalog + demo-role seeding:
  `rbac/seed-rbac-catalog.ts` (14 roles, 79 permission strings, role→permission mappings),
  `rbac/role-management.*`, entities `role`/`permission`/`role-permission`.
- **Enforcement** — `@hospital/auth-guards`: `PermissionGuard` + `@RequirePermissions(...)` on
  controllers/actions, `patient-auth.guard` for patient-scoped access, shared
  `request-context.ts` for typed `req.authContext`. UI permission checks are cosmetic; this guard
  is authoritative.

## 6. Module map (overview)

Full per-module table with routes/key files/spec links: **`Module-Reference.md`**. Grouped:

| Area | Modules |
|---|---|
| Platform / system admin | `accounts`, `tenants`, `platform-billing`, `platform-branding`, `packages`, `auth` (platform tier) |
| Identity & RBAC | `auth`, `rbac`, `accounts` (roles/wards), `directory` (entity-name resolver), `master-data` |
| Patient & clinical | `patients`, `patient-portal`, `clinical/vitals`, `clinical/triage`, `clinical/encounters`, `admissions`, `appointments`, `maternity`, `vaccination`, `nursing`, `ot`, `cssd` |
| Orders & diagnostics | `orders`, `lab`, `radiology`, `directory` (resolver) |
| Finance & money | `billing`, `accounting`, `insurance`, `fraction`, `payroll`, `platform-billing`, `packages` |
| Supply chain & ops | `inventory`, `pharmacy`, `ward-supply`, `fixed-assets`, `ssu` |
| Workforce & engagement | `employee`, `helpdesk`, `marketing`, `notifications` |
| Cross-cutting | `audit`, `reporting`, `database`, `rbac`, `directory` |

## 7. Cross-cutting concerns

- **Audit trail** — `@hospital/audit-emitter` (TypeORM `audit.subscriber` + diff builder +
  `@AuditExclude`), consumed by `audit` module's `persisting-audit-event-publisher` →
  `audit-record` rows with serialized diffs of structural mutations.
- **Reporting event archiver** — `reporting` module's `reporting.subscriber` intercepts critical
  business operations (order placed, patient admitted, …) and normalizes them into the flat
  `reporting_events` table powering dashboard read APIs, CSV export (`reporting-csv.util.ts`) and
  a PDF document (`reporting-events-pdf-document.ts`).
- **Observability** — `@hospital/observability`: pino structured logger
  (`ObservabilityLoggerModule`), metrics (`ObservabilityMetricsModule`, `GET /api/metrics`,
  unauthenticated), request timing middleware.
- **Rate limiting** — Redis-backed `ThrottlerModule` (see §3); default ceiling env-tunable via
  `RATE_LIMIT_DEFAULT`.
- **Document generation** — `@hospital/pdf` (pdfmake) powers `*-document.ts` builders:
  patient ID label, lab report + specimen label, radiology report + requisition label, pharmacy
  dispensing label, accounting report PDFs, reporting-events PDF.
- **Excel/CSV export** — `@hospital/excel` (`excel.service`) + per-feature CSV utils: accounting
  reports (`export.csv`/`.pdf`/`.xlsx` endpoints under `accounting/reports/...`), reporting
  dashboard Excel endpoints.
- **Object storage** — `@hospital/object-storage` (MinIO) for binary assets.
- **Pagination** — `@hospital/pagination` (`paginate` util, `PaginatedResponseDto`,
  `PaginationQueryDto`, `require-param`); list/search endpoints across modules return the shared
  paginated envelope.
- **Error/validation shape** — global `ValidationPipe`, `createApiValidationPipe`, Nest exception
  filters; BFF-style aggregation endpoints degrade partially rather than 500.

## 8. Run / deploy shape (dev)

`backend/code/docker-compose.dev.yml`: `api-postgres` (Postgres 16, host **5435:5432**), `api-redis`
(host 6380:6379), `api-minio` (host 9002:9000 + 9003:9001 console), `api` (node:22-alpine,
`pnpm nx serve api`, container port 3000 → **host 3005**), plus exactly three seed services behind
the `seed` profile: `seed-rbac`, `seed-initial-setup`, `seed-all` (the `seed-demo-*` catalog/data
seeds are nx targets, not compose services). Key env vars: `DB_HOST/DB_PORT/DB_USERNAME/
DB_PASSWORD/DB_DATABASE`, `REDIS_HOST/REDIS_PORT`, `OBJECT_STORAGE_*`, `JWT_SECRET`, `PORT`,
`RATE_LIMIT_DEFAULT`; the global prefix is the code constant `API_GLOBAL_PREFIX` (`api` in
`libs/tenant-context/src/lib/unauthenticated-routes.ts`), not an env var. Local defaults without
compose: DB port **5433** (compose host port is now 5435 — export `DB_PORT` when host-running),
Redis port **6380** (see `apps/api/src/database/data-source.ts` and the throttler comments in
`app.module.ts`). Swagger: `http://localhost:3005/api/docs`.

Seeds (`apps/api/src/database/*-runner.ts`, run via `pnpm nx run api:seed-*`): RBAC permission
catalog + demo roles, initial setup (platform + demo tenant), demo data/demo accounts, health
packages catalog, ledger accounts. Rerunnable.

## 9. Testing strategy

- Unit specs beside code (Jest, `@swc/jest`); integration specs (`*.integration-spec.ts`,
  `TenantTestContext` helper in `apps/api/src/testing/`) boot `AppModule` per suite with per-app
  throttling storage.
- Rigor scales to risk: full integration coverage for tenant isolation, money (billing/
  accounting/payroll/insurance) and clinical sign-off; lighter unit tests for low-risk CRUD.
- CI (`backend/code/.github/workflows/ci.yml`) runs `test` + `typecheck`
  (`pnpm exec nx run-many -t typecheck test` — typecheck catches ESM `.js`-extension import
  errors Jest does not).

## 10. Recent additions worth knowing (Sep 2026 hardening wave)

- **Document & Print** — patient ID label, lab specimen & radiology requisition labels, pharmacy
  dispensing label as PDFs (incremental "slices" recorded in `review-comments.md`).
- **Report exports** — accounting reports (`accounting/reports/.../export.{csv,pdf,xlsx}`) and
  reporting-dashboard Excel export endpoints.
- **Directory resolver** — `directory` extended with six more entity types so the UI can resolve
  raw UUIDs to display names app-wide.
- **RBAC gap fixes** — PRD-mandated read access granted per role (Lab/Radiology technicians,
  Billing/Accounts staff, Inventory/Store manager, Helpdesk, Auditor), matching
  `review-comments.md` findings closed in the same wave.
- **Helpdesk** — tickets carry resolved requester/assignee names.
- **Demo accounts** — Helpdesk Agent, HR/Payroll Admin, Auditor; reseed scripts rerunnable.
- **Lab/Radiology requisition creation + patient identity** — `patientId` exposed on
  requisition list/detail responses.

---

_Last verified against commit `1d6b01e` (2026-09-02). Companion docs: `Module-Reference.md` (this
directory), `Deployment-Guide.md`, `Runbook.md`, `Development-Standards.md`, `PRD.md`._
