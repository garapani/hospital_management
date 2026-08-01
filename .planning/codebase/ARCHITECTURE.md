<!-- refreshed: 2026-08-01 -->
# Architecture

**Analysis Date:** 2026-08-01

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Layer (Nest Controllers)              │
│  `new/code/apps/api/src/<feature>/<feature>.controller.ts`    │
│  Guarded by PermissionGuard (`@hospital/auth-guards`)         │
└──────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                Middleware: TenantContextMiddleware             │
│  `libs/tenant-context/src/lib/tenant-context.middleware.ts`   │
│  Reads x-tenant-id / x-account-id / x-correlation-id headers  │
│  Stores in AsyncLocalStorage-backed TenantContextService      │
└──────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                Service Layer (business logic)                  │
│  `new/code/apps/api/src/<feature>/<feature>.service.ts`       │
│  Wraps queries in `TenantConnectionService.runInTenantSchema`  │
└──────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│           TenantConnectionService (schema-per-tenant)          │
│  `apps/api/src/database/tenant-connection.service.ts`          │
│  SET search_path TO "tenant_<id>", public per request           │
└──────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│         TypeORM DataSource (single Postgres instance)          │
│  `apps/api/src/database/data-source.ts`                        │
│  Global via `DatabaseModule` (`@Global()`)                     │
└──────────────────────────┬─────────────────────────────────┘
                            │  TypeORM subscribers fire on insert/update/delete
                            ▼
┌───────────────────────────┬───────────────────────────────────┐
│   AuditSubscriber          │   ReportingSubscriber              │
│  `libs/audit-emitter/...`  │  `apps/api/src/reporting/          │
│  Diffs before/after,       │   reporting.subscriber.ts`         │
│  publishes to audit_records│  Maps entity → domain event,       │
│  (excludes flagged fields) │  publishes to reporting_events     │
└───────────────────────────┴───────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| AppModule | Wires all feature modules, applies tenant middleware globally | `new/code/apps/api/src/app/app.module.ts` |
| TenantContextMiddleware | Extracts tenant/account/correlation IDs from headers into AsyncLocalStorage | `new/code/libs/tenant-context/src/lib/tenant-context.middleware.ts` |
| TenantContextService | Read/write accessor for the current-request tenant context | `new/code/libs/tenant-context/src/lib/tenant-context.service.ts` |
| DatabaseModule | Provides a single global TypeORM `DataSource` and `TenantConnectionService` | `new/code/apps/api/src/database/database.module.ts` |
| TenantConnectionService | Runs a unit of work with Postgres `search_path` set to the tenant's schema | `new/code/apps/api/src/database/tenant-connection.service.ts` |
| PermissionGuard | Route-level authorization; reads required permission from `@RequirePermission` metadata, checks `x-permissions` header | `new/code/libs/auth-guards/src/lib/permission.guard.ts` |
| AuditSubscriber | TypeORM entity subscriber; builds before/after diffs and publishes audit records on insert/update/delete | `new/code/libs/audit-emitter/src/lib/audit.subscriber.ts` |
| ReportingSubscriber | TypeORM entity subscriber; maps specific entity inserts (Order, Invoice, Payment, Deposit, Admission, BedTransfer) to named domain events | `new/code/apps/api/src/reporting/reporting.subscriber.ts` |
| PersistingReportingEventPublisher | Persists reporting events to `reporting_events` table via the same transaction manager | `new/code/apps/api/src/reporting/persisting-reporting-event-publisher.ts` |
| Feature modules (one per bounded context) | Controller + Service + DTOs + Entities per domain area | `new/code/apps/api/src/{accounts,admissions,appointments,auth,billing,clinical,master-data,orders,patients,rbac,tenants,reporting}` |

## Pattern Overview

**Overall:** Modular monolith on NestJS (Nx monorepo), single Postgres instance with schema-per-tenant multi-tenancy, feature-sliced module structure, TypeORM entity subscribers used as an in-process event/outbox mechanism for audit trail and reporting projections.

**Key Characteristics:**
- One NestJS app (`apps/api`) importing ~13 independent feature modules, no inter-service network calls — this is not (yet) a microservices architecture.
- Multi-tenancy via Postgres schema-per-tenant (`tenant_<id>`), selected per-request by setting `search_path` on a dedicated `QueryRunner`, not via separate databases or a `tenant_id` column filter.
- Cross-cutting concerns (audit trail, reporting event capture) are implemented as TypeORM `EntitySubscriberInterface` implementations that hook `afterInsert`/`afterUpdate`/`afterRemove`, not as explicit service-layer calls — write paths are unaware they are being audited/reported on.
- Request-scoped state (tenant/account/correlation IDs) flows via `AsyncLocalStorage` (`TenantContextService`), not via NestJS request-scoped providers.
- Authorization is a flat permission-string check (`x-permissions` header) enforced by a single `PermissionGuard` + `@RequirePermission()` decorator — no role hierarchy evaluated at the API layer (RBAC entities exist under `rbac/` but permission resolution into the header is external/not yet shown in this app).
- Shared cross-feature code lives in Nx libs (`@hospital/tenant-context`, `@hospital/auth-guards`, `@hospital/audit-emitter`) rather than in `apps/api/src`.

## Layers

**HTTP/Controller Layer:**
- Purpose: route definitions, request/response DTO mapping, guard/permission annotation
- Location: `new/code/apps/api/src/<feature>/<feature>.controller.ts`
- Contains: `@Controller()` classes, `@Get/@Post/@Patch` handlers, `@UseGuards(PermissionGuard)`, `@RequirePermission('resource.action')`
- Depends on: feature Service, DTOs, `@hospital/auth-guards`
- Used by: Nest HTTP router (Express adapter, `main.ts`)

**Service Layer:**
- Purpose: business rules, validation, orchestration of one or more repository calls within a tenant-scoped transaction
- Location: `new/code/apps/api/src/<feature>/<feature>.service.ts`
- Contains: `@Injectable()` classes taking `TenantConnectionService` (or `DataSource`) as a constructor dependency
- Depends on: `TenantConnectionService`, TypeORM entities, other feature services (e.g. `PatientNumberGeneratorService`)
- Used by: Controllers

**Persistence Layer (TypeORM entities + tenant connection):**
- Purpose: entity definitions and per-tenant schema routing
- Location: `new/code/apps/api/src/<feature>/entities/*.entity.ts`, `new/code/apps/api/src/database/`
- Contains: `@Entity()` classes, migrations (`database/migrations/NNNN-*.ts`), `TenantConnectionService`, `data-source.ts`
- Depends on: TypeORM, Postgres (`pg`)
- Used by: Service layer

**Cross-cutting subscriber layer:**
- Purpose: derive audit records and reporting events from persistence-layer writes without touching service code
- Location: `new/code/libs/audit-emitter/src/lib/audit.subscriber.ts`, `new/code/apps/api/src/reporting/reporting.subscriber.ts`
- Contains: TypeORM `EntitySubscriberInterface` implementations registered against the shared `DataSource`
- Depends on: `TenantContextService` (for tenant/account/correlation IDs), entity metadata
- Used by: nothing directly — invoked implicitly by TypeORM on every insert/update/delete

**Shared libs (Nx workspace libraries):**
- Purpose: cross-feature infrastructure reused by every module
- Location: `new/code/libs/tenant-context`, `new/code/libs/auth-guards`, `new/code/libs/audit-emitter`
- Contains: middleware, guards, decorators, subscribers, `AsyncLocalStorage` context, publisher interfaces
- Depends on: `@nestjs/common`, `typeorm`
- Used by: `apps/api` feature modules via `@hospital/<lib-name>` imports (workspace protocol)

## Data Flow

### Primary Request Path (example: create order)

1. HTTP `POST /api/orders` hits Express → `TenantContextMiddleware.use()` reads `x-tenant-id`/`x-account-id`/`x-correlation-id` headers and runs the rest of the request inside `TenantContextService.run()` (`new/code/libs/tenant-context/src/lib/tenant-context.middleware.ts:10-18`)
2. `PermissionGuard.canActivate()` checks `x-permissions` header against `@RequirePermission('order.manage')` metadata on `OrdersController.create` (`new/code/libs/auth-guards/src/lib/permission.guard.ts:14-38`, `new/code/apps/api/src/orders/orders.controller.ts:13-17`)
3. `OrdersController.create()` delegates to `OrdersService.create()` (`new/code/apps/api/src/orders/orders.controller.ts:15-17`)
4. `OrdersService.create()` validates input then calls `TenantConnectionService.runInTenantSchema()` (`new/code/apps/api/src/orders/orders.service.ts:34-76`)
5. `TenantConnectionService` opens a `QueryRunner`, sets `search_path` to the tenant's schema, and hands back an `EntityManager` scoped to that schema (`new/code/apps/api/src/database/tenant-connection.service.ts:14-31`)
6. Repository `.save()` calls insert `Order` and `OrderItem` rows inside that schema
7. TypeORM fires `afterInsert` on the shared `DataSource` — `AuditSubscriber` diffs and publishes an audit record; `ReportingSubscriber` matches `Order` in its event catalog, builds an `OrderPlaced` payload, and publishes via `PersistingReportingEventPublisher` (`new/code/libs/audit-emitter/src/lib/audit.subscriber.ts:30-41`, `new/code/apps/api/src/reporting/reporting.subscriber.ts:116-144`)
8. Response DTO (order + items) is returned to the controller and serialized as JSON

**State Management:**
- No client-side/UI state — this is an API-only NestJS app (Swagger docs served at `/api/docs`, `new/code/apps/api/src/main.ts:16-23`)
- Per-request state (tenant ID, account ID, correlation ID) lives only in `AsyncLocalStorage`, set once by middleware and read by services/subscribers downstream — never passed explicitly as function arguments

### Audit & Reporting Projection Flow

1. Any TypeORM `insert`/`update`/`remove` operation against an entity not excluded via `@AuditExclude()` triggers `AuditSubscriber.afterInsert/afterUpdate/afterRemove`
2. Subscriber resolves the entity class, skips if audit-excluded, builds a before/after diff (`buildAuditDiff`), and publishes to the configured `AUDIT_EVENT_PUBLISHER` token
3. Separately, `ReportingSubscriber` matches inserts against a hardcoded `eventCatalog` Map keyed by entity class (`Order`, `Invoice`, `Payment`, `Deposit`, `Admission`, `BedTransfer`) and publishes a named business event (`OrderPlaced`, `InvoiceCreated`, etc.) via `PersistingReportingEventPublisher`, writing into the `reporting_events` table (`new/code/apps/api/src/database/migrations/0017-create-reporting-tables.ts`)

## Key Abstractions

**Feature Module (Nest `@Module`):**
- Purpose: bounded-context slice — controller + service + DTOs + entities
- Examples: `new/code/apps/api/src/orders/orders.module.ts`, `new/code/apps/api/src/billing/billing.module.ts`, `new/code/apps/api/src/clinical/{vitals,encounters,triage}/*.module.ts`
- Pattern: `@Module({ controllers: [...], providers: [...Service], exports: [...Service] })`; no `imports: [TypeOrmModule.forFeature(...)]` pattern — entities are used directly via `manager.getRepository(Entity)` inside `runInTenantSchema`, not registered per-module

**TenantContextService (AsyncLocalStorage context):**
- Purpose: carries tenant ID, account ID, correlation ID through an entire request/transaction without prop-drilling
- Examples: `new/code/libs/tenant-context/src/lib/tenant-context.service.ts`
- Pattern: `run(context, callback)` establishes the context; `getTenantId()/getAccountId()/getCorrelationId()/getSchemaName()` read it anywhere downstream (services, subscribers)

**Entity Subscriber as Outbox:**
- Purpose: capture side effects (audit trail, reporting events) from data writes without instrumenting every service method
- Examples: `new/code/libs/audit-emitter/src/lib/audit.subscriber.ts`, `new/code/apps/api/src/reporting/reporting.subscriber.ts`
- Pattern: implements `EntitySubscriberInterface`, registered onto the shared `DataSource` (constructor-push for `ReportingSubscriber`, or DI-registered subscriber for `AuditSubscriber`), writes derived rows using the *same* `EntityManager`/transaction as the triggering write

**Publisher interface:**
- Purpose: decouples subscribers from the concrete persistence of derived events
- Examples: `new/code/libs/audit-emitter/src/lib/audit-event-publisher.interface.ts` (token `AUDIT_EVENT_PUBLISHER`), `new/code/apps/api/src/reporting/persisting-reporting-event-publisher.ts`
- Pattern: `publish(event, manager): Promise<void>` — always takes the in-flight `EntityManager` so the derived write is part of the same DB transaction as the source write

## Entry Points

**HTTP Server Bootstrap:**
- Location: `new/code/apps/api/src/main.ts`
- Triggers: process start (`node main.js` via Nx `serve` target)
- Responsibilities: creates the Nest app from `AppModule`, sets global prefix `api`, configures Swagger at `/api/docs`, listens on `PORT` (default 3000). Comment at top of file explicitly states: "This is not a production server yet! This is only a minimal backend to get started."

**AppModule:**
- Location: `new/code/apps/api/src/app/app.module.ts`
- Triggers: imported by `main.ts`
- Responsibilities: imports all feature modules (`TenantContextModule`, `AuthModule`, `TenantsModule`, `AuditModule`, `MasterDataModule`, `PatientsModule`, `AppointmentsModule`, `VitalsModule`, `EncountersModule`, `TriageModule`, `AdmissionsModule`, `OrdersModule`, `BillingModule`, `ReportingModule`); applies `TenantContextMiddleware` to all routes (`consumer.apply(...).forRoutes('*')`)

**Migration Runner:**
- Location: `new/code/apps/api/src/database/migrate.ts`
- Triggers: run manually/via script for schema migrations
- Responsibilities: applies numbered migrations under `database/migrations/` against the configured Postgres instance

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop (standard Nest/Express); no worker threads or queues observed.
- **Global state:** `DatabaseModule` is `@Global()` and provides a single shared `DataSource` singleton (`new/code/apps/api/src/database/database.module.ts:7-24`) — every tenant's queries flow through one connection pool, isolated only by `search_path`, not by separate connections/pools per tenant.
- **Request-scoped state via AsyncLocalStorage:** `TenantContextService` is a normal singleton provider, not a Nest request-scoped provider; correctness depends on every async call chain staying inside the `AsyncLocalStorage.run()` callback established by the middleware. Any code that escapes that callback (e.g., unawaited fire-and-forget promises, `setTimeout`) will read `undefined` tenant context.
- **No `TypeOrmModule.forFeature()` per-module registration:** entities are accessed via `manager.getRepository(Entity)` inside `TenantConnectionService.runInTenantSchema`, so there is no compile-time record of "which entities this module owns" — everything is reachable from everywhere given import access to the entity class.
- **Schema name is a runtime string built from tenant ID:** `TenantConnectionService` validates it against `SAFE_SCHEMA_NAME = /^tenant_[a-z0-9_]+$/` before interpolating it into raw SQL (`SET search_path TO "..."`) — this is a deliberate SQL-injection guard given the schema name cannot be parameterized.

## Anti-Patterns

### Silent context loss outside AsyncLocalStorage

**What happens:** Any code that runs after the request's async context has been left (unawaited background work, event emitters firing after response) will find `TenantContextService.getTenantId()` etc. returning `undefined`.
**Why it's wrong:** `TenantConnectionService.runInTenantSchema` throws `'No tenant context set'` if this happens inside the request path, but background/deferred work fails silently or throws far from its trigger, making tenant-context bugs hard to trace.
**Do this instead:** Keep every tenant-scoped operation inside the same awaited call chain that started under `TenantContextMiddleware`; do not schedule tenant-scoped work via `setTimeout`/fire-and-forget promises without re-establishing context.

### Implicit entity-to-module ownership

**What happens:** Modules don't declare which entities they own via `TypeOrmModule.forFeature()`; any service can `manager.getRepository(SomeOtherFeaturesEntity)` directly (e.g. `OrdersService` reads `Patient` from `patients/entities/patient.entity.ts`, `new/code/apps/api/src/orders/orders.service.ts:5,45`).
**Why it's wrong:** Cross-feature coupling is invisible at the module-import level; there's no static boundary preventing one feature from reaching into another feature's persistence internals.
**Do this instead:** When adding new cross-feature reads, prefer calling the owning feature's service (if one exists) over reaching into its entity directly, to keep the coupling visible and centralize validation logic. This is a repo-wide convention gap, not enforced by tooling — be conservative about introducing new direct entity reaches from other features.

## Error Handling

**Strategy:** Standard NestJS exception filters — services throw built-in HTTP exceptions (`NotFoundException`, `ConflictException`, `BadRequestException`, `ForbiddenException`) which Nest's default exception layer converts to the corresponding HTTP status + JSON body.

**Patterns:**
- Guard clauses at the top of service methods validate input and throw `BadRequestException` before any DB work (`new/code/apps/api/src/orders/orders.service.ts:35-42`)
- Not-found lookups throw `NotFoundException` immediately after a `findOne` returns null (`new/code/apps/api/src/orders/orders.service.ts:46-48,81-83`)
- State-transition guards throw `ConflictException` when an entity is not in the expected status (`new/code/apps/api/src/orders/orders.service.ts:117-119,135-137`)
- Subscribers swallow/log errors rather than propagate: `ReportingSubscriber.afterInsert` catches build/publish failures and logs via `Logger.error`, allowing the triggering write to succeed even if the reporting projection fails (`new/code/apps/api/src/reporting/reporting.subscriber.ts:124-143`)

## Cross-Cutting Concerns

**Logging:** NestJS built-in `Logger` class, per-class instances (`new Logger(ClassName.name)`), used in `main.ts` for startup banners and in subscribers for warnings/errors. No structured/external logging framework observed.

**Validation:** `class-validator`/`class-transformer` DTOs (dependency present in `package.json`); DTOs live under `<feature>/dto/*.dto.ts` per module.

**Authentication/Authorization:** Two separate concerns — `AuthModule`/`AuthService` (`new/code/apps/api/src/auth/`) presumably issues credentials (JWT dependency present: `@nestjs/jwt`), while `PermissionGuard` (from `@hospital/auth-guards`) performs per-route authorization purely off the `x-permissions` request header, decoupled from any token-verification step visible in this guard.

---

*Architecture analysis: 2026-08-01*
