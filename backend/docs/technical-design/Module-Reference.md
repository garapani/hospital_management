# Module Reference — Hospital EMR Backend (vaidya)

Quick-reference map of the NestJS/Nx modular-monolith backend at `backend/code` (app `vaidya`,
package root `backend/code/package.json`). It answers "where is X and how does it work" for a
developer or agent new to the codebase. Everything here was verified against the code on the
commit in the footer; where a claim could not be verified it is marked **[unverified]** or
`TODO(verify)`. This file deliberately does not restate architecture-level reasoning — see
[Technical-Design.md](./Technical-Design.md) for that.

Conventions used below:

- Paths are relative to `backend/code/` unless they start with `backend/docs/`.
- All feature modules live under `apps/api/src/<module>`. Clinical sub-modules live under
  `apps/api/src/clinical/{vitals,encounters,triage}`.
- **Level** says where the module's data lives: `platform` (public Postgres schema, reserved
  `__platform` tenant context), `tenant` (each hospital's own `tenant_<id>` schema), or `hybrid`.
- **Route prefixes** come from grepping `@Controller('...')` in that module. Routes are mounted
  under the global prefix `api` (`API_GLOBAL_PREFIX` in
  `libs/tenant-context/src/lib/unauthenticated-routes.ts`), so the Swagger path for a controller
  is `http://<host>:<port>/api/docs`.
- **Permissions** are catalog strings defined in
  `apps/api/src/rbac/seed-rbac-catalog.ts` (the seed catalog), enforced at runtime by
  `@RequirePermission(...)` + `PermissionGuard` (`libs/auth-guards`). Catalog descriptions in that
  file are the authoritative one-line gloss for what each permission means.

---

## How the API is wired

Entry chain (all verified):

1. **`apps/api/src/main.ts`** — `NestFactory.create(AppModule)` with pino logger
   (`app.useLogger(app.get(PinoLogger))`), `enableShutdownHooks()`, CORS (default allows
   `localhost:4200` and subdomains; `CORS_ORIGIN` env var is a comma-separated allow-list),
   `useGlobalPipes(createApiValidationPipe())`, `setGlobalPrefix(API_GLOBAL_PREFIX)` (`api`),
   Swagger at **`/api/docs`** (bearer auth, custom theme), listens on `PORT` (default `3000`).
2. **`apps/api/src/app/api-validation-pipe.ts`** — `ValidationPipe` with `transform: true`,
   `enableImplicitConversion: true`, `whitelist: true`, `forbidNonWhitelisted: false`. Registered
   globally (see design spec
   `backend/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md`).
3. **`apps/api/src/app/app.module.ts`** — module registration order is meaningful only in that
   NestJS resolves the dependency graph from it; the commented notes explain history (the old
   three-named-throttler bug, the Redis port-6380 default, why tests fall back to in-memory
   throttler storage). Imports, in order:

   - `ThrottlerModule.forRootAsync` — one named `default` throttler, ttl 60 s, limit
     `RATE_LIMIT_DEFAULT` (default `100`/min); storage is `ThrottlerStorageRedisService` on
     `REDIS_HOST`/`REDIS_PORT` (default `localhost:6380`) **except** when `NODE_ENV=test`, which
     uses in-memory storage. Registered as a global `APP_GUARD` (`ThrottlerGuard`).
   - `ObservabilityLoggerModule`, `ObservabilityMetricsModule` (`@hospital/observability`).
   - `TenantContextModule`, then every feature module (auth … vaccination) — the full import
     list in the file is the authoritative "what ships" list (41 modules incl. the clinical trio).
   - Global `APP_GUARD`: `ThrottlerGuard`. (Permission gating is *not* a global guard: each
     controller opts in with `@UseGuards(PermissionGuard)`.)

   Middleware chain (registered in `AppModule.configure`, runs in this order for every route):

   | Order | Middleware | One-line responsibility |
   |---|---|---|
   | 1 | `AuthContextMiddleware` (`@hospital/auth-guards`) | Verifies the `Bearer` access JWT (HS256, `type: 'access'`, `sub`+`hospitalId` present) and sets `req.authContext`; excluded from `UNAUTHENTICATED_ROUTES`. |
   | 2 | `TenantContextMiddleware` (`@hospital/tenant-context`) | Pushes `{tenantId, accountId, patientId, wardId, correlationId}` into an `AsyncLocalStorage` store for the request; tenant comes from the JWT when authenticated, else from `x-tenant-id`/`x-account-id` headers (only expected on unauthenticated routes; logs a warning otherwise). |
   | 3 | `metricsMiddleware` (`@hospital/observability`) | Times every request and records `http_requests_total` / `http_request_duration_seconds` (labels method/route/status/tenant). |

   Per-route guard stack: throttler (global) → `PermissionGuard` (per controller) → handler
   `@RequirePermission` metadata (handler-level wins, falls back to class-level).

4. **`apps/api/src/database/`** — DataSource lifecycle, tenant provisioning, migrations (details
   in "Database & tenancy").

### Validation & error shaping

- One global validation pipe (above). DTOs live in each module's `dto/` folder.
- Standard NestJS HTTP exceptions; `UnauthorizedException`/`ForbiddenException` come from the auth
  middleware and permission guard respectively. There is no bespoke global exception filter
  (verified: no `@Catch`/`ExceptionFilter`/`useGlobalFilters` anywhere under `apps/api/src`).

---

## Shared libraries (`@hospital/*`)

All libs live under `libs/`, are `"type": "module"`, and are workspace packages (`workspace:*`).

| Lib | What it does | Consumers |
|---|---|---|
| `tenant-context` | Global `AsyncLocalStorage` request store (`tenantId`, `accountId`, `patientId`, `wardId`, `correlationId`); `TenantContextService.getSchemaName()` → `tenant_<id>`; `TenantContextMiddleware`; `UNAUTHENTICATED_ROUTES` + `API_GLOBAL_PREFIX` (`api`). | Every module (via global module + middleware). |
| `auth-guards` | `AuthContextMiddleware` (JWT → `req.authContext`), `PermissionGuard` + `RequirePermission` decorator, `PatientAuthGuard` (patient-portal only), `RequestContextFactory`. | Middleware app-wide; guards per controller; `notifications` uses `RequestContextFactory`. |
| `audit-emitter` | TypeORM entity subscriber capturing afterInsert/Update/Remove, builds a column diff (honoring `@AuditExclude` field/entity decorators) and publishes an `AuditEvent` to the `AUDIT_EVENT_PUBLISHER` token. | `AuditModule` (global) binds the publisher; audit rows land per tenant schema. |
| `observability` | pino structured logging (nestjs-pino; PHI-path redaction; tenant/account/correlation mixin) + prom-client metrics service, `GET /metrics` controller (deliberately unauthenticated, aggregate counters only) and the `metricsMiddleware`. | Global (logger + metrics in `AppModule`). |
| `object-storage` | MinIO client; global module. Objects are namespaced under the tenant: `putObject/getObject/removeObject/presignedGetUrl(tenantId, key, …)`; bucket `OBJECT_STORAGE_BUCKET` (default `hospital-objects`). | `lab`, `radiology` (archive generated report PDFs), `platform-branding` (logo), `tenants` (purge cleanup). |
| `excel` | Thin `exceljs@4.4.0` wrapper: `ExcelService.renderWorkbook(sheets)` → xlsx Buffer. | `accounting` (report exports), `reporting` (events/revenue xlsx). |
| `pdf` | Thin `pdfmake@0.2.20` wrapper: `PdfService.render(docDefinition)` → PDF Buffer. | `lab`, `radiology`, `patients` (ID label), `pharmacy` (dispensing label), `accounting` (report PDFs), `reporting` (events PDF). |
| `pagination` | `PaginationQueryDto` (page/limit), `PaginatedResponseDto<T>` `{data, meta:{total,page,limit,totalPages}}`, `paginate()`/`paginateRaw()` over TypeORM query builders (clamps page ≥ 1, limit 1–100, default 20), `requireParam` util. | List endpoints across modules (`audit`, `reporting`, `patients`, etc. — every module DTO extending `PaginationQueryDto`). |

- `backend/code/packages/` — empty in this workspace (no top-level packages dir content).
- `backend/code/scripts/` — `backup-db.sh` (DB backup helper).
- `backend/code/data/` — local dev runtime volumes (`minio`, `postgres`, `redis`, plus a broken
  leftover `postgres.broken-*`); the DB volume holds the `hospital_db` data files.
- `backend/code/swagger.json` — exported OpenAPI document snapshot at the repo root.

---

## Feature modules

Groups below are organizational only. "Spec" links point to verified files under
`backend/docs/superpowers/specs/`.

### Platform / System Administration (superadmin console)

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **tenants** | platform | `tenants` | `apps/api/src/tenants/tenants.controller.ts`, `tenants.service.ts`, `tenants.module.ts`, `entities/tenant.entity.ts`, `platform-tenant.ts` | Database, Packages, Accounts, ObjectStorage, TenantProvisioningService | Tenant registry (public schema). Provisioning end-to-end: schema/role/migrations via `TenantProvisioningService`, registry row (`status` default `active`; statuses `active`/`suspended`/`archived`/`purged` with `activatedAt`/`suspendedAt`/`archivedAt`/`purgedAt`), `tenant_roles` membership, optional department-catalog seeding, bootstrap Hospital Admin. Endpoints: `POST /tenants`, `GET`, `GET /:hospitalId`, `GET`/`PATCH /:hospitalId/roles`, `PATCH /:hospitalId/package`, `PATCH /:hospitalId/{suspend,reactivate,archive,restore,purge}` — all gated by `system-admin.tenants.manage`. Purge = single transaction (`DROP SCHEMA` + registry row → `purged` tombstone; role drop + logo removal best-effort after commit). Reserved `__platform` tenant is never listed/provisionable/suspendable. Specs: `2026-08-13-platform-superadmin-console-design.md`, `2026-08-23-tenant-status-guards-design.md`. |
| **packages** | platform | `packages` | `apps/api/src/packages/packages.controller.ts`, `packages.service.ts`, `package-catalog.ts`, `seed-packages-catalog.ts`, `entities/package.entity.ts` | Database | SaaS tier catalog `basic`/`standard`/`enterprise` — `package-catalog.ts` (`PACKAGE_CATALOG`: module lists, default roles, ₹ list prices) is the source of truth; the DB `packages.modules` column is vestigial. `PackagesService.filterPermissions` strips permissions whose module prefix is not in the tenant's package at login/refresh (`MODULE_PERMISSION_PREFIXES`, `ALWAYS_ON_PERMISSION_PREFIXES` = `identity`/`master-data`/`users`/`system`/`audit`; unresolvable package fails closed to Basic). Access gating only; schema stays uniform. `GET /packages`. |
| **platform-billing** | platform | `platform/billing` | `apps/api/src/platform-billing/platform-billing.controller.ts`, `subscription-billing.service.ts`, `entities/subscription.entity.ts`, `entities/subscription-invoice.entity.ts` | Database, Tenants | SaaS subscription billing for tenants (public schema): subscribe/cancel a `Subscription` (`status` `active`/`canceled`, `billingCycle` `monthly`/`annual`), issue one `SubscriptionInvoice` per period (18% platform GST; deterministic number `SI-<subscriptionId8>-<periodStart>`; unique per period), `POST invoices/:invoiceId/paid` marks paid and advances the period (renewal). Advisory locks (`platform_billing:<tenantId>` etc.) serialize per-tenant billing; `TenantsService.assertValidHospitalTenant(['active','suspended'])` gates (billing continues during suspension; purge preserves subscription history deliberately). All gated `system-admin.tenants.manage`. |
| **platform-branding** | hybrid | `branding` (public) + `platform/tenants/:hospitalId/branding` (admin) | `apps/api/src/platform-branding/tenant-branding.controller.ts`, `platform-branding.controller.ts`, `platform-branding.service.ts`, `entities/tenant-branding.entity.ts` | Database, Tenants, ObjectStorage | Public `GET /branding` (`TenantBrandingController`, tenant from `x-tenant-id` header, `@Throttle` 120/min, listed in `UNAUTHENTICATED_ROUTES` so auth middleware skips it) returns per-tenant white-label branding incl. a `presignedGetUrl` (1 h) for the logo. Admin controller (`platform/tenants/:hospitalId/branding`) does `GET`/`PUT` upsert, `POST logo` (multer 2 MB cap; png/jpeg/webp only — SVG rejected as stored-XSS risk), `DELETE logo`; logo stored in object storage under `branding/logo.<ext>`, cleaned up on replace/purge. Gated `system-admin.tenants.manage`. |

### Identity, Access & RBAC

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **auth** | hybrid | `auth` | `apps/api/src/auth/auth.controller.ts`, `auth.service.ts`, `auth.module.ts`, `jwt-secret.ts`, `dto/*` | TenantContext, Accounts, Packages, Tenants, JwtModule | `POST /auth/login`, `POST /auth/change-password`, `POST /auth/refresh` — all unauthenticated (`UNAUTHENTICATED_ROUTES`) and throttled to 5/min (non-test) via `@Throttle` overrides. Access token TTL 15 min, refresh 7 d, stateless rotation. Login lockout after 5 failures for 15 min; tenant-status gate (only `active` tenants may authenticate); `needsPasswordUpdate` accounts get no tokens until they change the initial password. `jwt-secret.ts` resolves `JWT_SECRET`, throws in production if missing. Specs: `2026-07-30-identity-access-service-design.md`, `2026-08-03-jwt-request-authentication-design.md`. |
| **accounts** | tenant | `accounts` | `apps/api/src/accounts/accounts.controller.ts`, `accounts.service.ts`, `entities/account.entity.ts`, `entities/account-role.entity.ts` | TenantContext, Database, Audit | Staff & patient login accounts. Endpoints: `POST /accounts`, `GET /accounts`, `GET /accounts/:id`, `PATCH :id/{deactivate,reactivate,unlock}`, `POST :id/reset-password`, `PATCH :id/ward`, `POST :id/roles`, `DELETE :id/roles/:accountRoleId`, plus auth-only `POST /accounts/me/password` (the only self-scoped `/me` endpoint) and lookups `GET /accounts/roles` and `GET /accounts/directory`. Permissions: `identity.accounts.manage`, `identity.accounts.directory`. Account columns (verified in `account.entity.ts`): `accountType` (`staff`/`patient`), `displayName`, `isActive`, `needsPasswordUpdate`, `failedLoginAttempts`, `lockedUntil`, `username`, `email`, `passwordHash` (carries `@AuditExclude()` so hashes never enter audit diffs), `patientId`, `wardId`. bcrypt cost 12; `account_roles` is not an ORM relation — `AccountsService.attachRoles()` joins tenant-schema `account_roles` rows to platform-schema `Role` rows in code. Spec: `2026-07-31-accounts-roles-admin-api-design.md`. |
| **rbac** | hybrid | (root-level) `roles` | `apps/api/src/rbac/role-management.controller.ts`, `role-management.service.ts`, `seed-rbac-catalog.ts`, `entities/{role,permission,role-permission}.entity.ts` | Database | Global role/permission catalog (public schema) + role→permission mappings. The role-management controller uses a bare `@Controller()` (no prefix), so routes mount at `/api/roles`: `GET/POST /roles`, `PATCH /roles/:id`, `PATCH /roles/:id/{deactivate,reactivate}` — all gated by `rbac.manage` (platform-only, Super Admin; hospital admins assign roles via tenant-scoped `/accounts` instead). Seed catalog (`seed-rbac-catalog.ts`) upserts 14 roles (Super Admin `isCrossTenant: true`, Hospital Admin, Receptionist / Front Desk, Doctor, Nurse, Lab Technician, Radiology Technician, Pharmacist, Billing/Accounts Staff, Inventory/Store Manager, HR/Payroll Admin, Helpdesk Agent, Auditor/Compliance, Patient) and a 79-string permission catalog (`identity.*`, `system-admin.*`, `rbac.manage`, `master-data.*`, `patients.*`, `appointment.*`, `vitals.*`, `encounter.*`, `triage.*`, `admission.*`, `order.*`, `billing.*`, `reporting.read`, `audit.read`, `lab.*`, `radiology.*`, `inventory.*`, `pharmacy.*`, `fixed-asset.*`, `insurance.*`, `accounting.*`, `ward-supply.*`, `nursing.*`, `ot.*`, `maternity.*`, `cssd.*`, `employee.*`, `payroll.*`, `fraction.*`, `helpdesk.*`, `notification.read`, `marketing.*`, `ssu.*`, `vaccination.*`) with role mappings; role names are immutable on update and cross-tenant roles cannot be deactivated. |
| **audit** | hybrid | `audit` | `apps/api/src/audit/audit.controller.ts`, `audit.service.ts`, `persisting-audit-event-publisher.ts`, `audit-wiring.service.ts`, `entities/audit-record.entity.ts` | TenantContext, Database, @hospital/audit-emitter | Global module. Binds `AUDIT_EVENT_PUBLISHER` to `PersistingAuditEventPublisher`, which writes an `Audit`-kind `outbox_events` row on the SAME manager as the business transaction (atomic with it) — a separate `outbox-dispatcher` service later materializes it into `AuditRecord` rows (`@Entity('audit_records')`, diff as `jsonb`) in the tenant schema. Platform-level entities (no active tenant context) are skipped, not written. `GET /audit` search over the last 24 h default, filters on table/action/actor/recordId/correlationId, gated by `audit.read`. Specs: `2026-07-31-audit-service-persistence-design.md`, `2026-08-22-entity-audit-columns-design.md`. |
| **master-data** | tenant | root-level: `departments`, `wards`, `beds`; `catalogs/departments` | `apps/api/src/master-data/master-data.controller.ts`, `department-catalog.controller.ts`, `master-data.service.ts`, `department-catalog.service.ts`, `entities/{department,ward,bed,department-catalog}.entity.ts` | TenantContext, Database | Tenant-scoped departments/wards/beds CRUD (`master-data.manage` writes, `master-data.read` reads) — all reads/writes inside the tenant schema. Shared `DepartmentCatalog` (`department_catalog` table) is platform-level, managed under `catalogs/departments`, gated by `rbac.manage`, and its rows are copied into each new tenant's `departments` at provisioning. `Ward`/`Bed` carry bed occupancy status used by admissions. Spec: `2026-07-31-master-data-departments-wards-design.md`. |

### Patients, Directory & Patient Engagement

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **patients** | tenant | `patients` | `apps/api/src/patients/patients.controller.ts`, `patients.service.ts`, `patient-number-generator.service.ts`, `patient-id-label-document.ts`, `entities/{patient,patient-address,patient-kin,patient-sequence}.entity.ts` | Database, Accounts, @hospital/pdf | MPI: register (`POST /patients`, `POST /patients/check-duplicates`), list/get, update, deactivate (`DELETE`), `POST /patients/:id/portal-invite`, and `GET /patients/:id/id-label.pdf` (PDF ID label via `@hospital/pdf`). Patient number via per-year sequence (`patient-sequence`). Permissions `patients.read/create/update/manage/portal-invite`. Spec: `2026-07-31-patient-management-design.md`. |
| **patient-portal** | tenant | `patient-portal` | `apps/api/src/patient-portal/patient-portal.controller.ts`, `patient-portal.service.ts` | Database | Patient self-service read API. Every endpoint is behind `@UseGuards(PatientAuthGuard)` (JWT `accountType: 'patient'` only) and returns `Cache-Control: no-store` PHI: `GET /patient-portal/{me,appointments,invoices,prescriptions,results}`. Spec: `2026-08-23-patient-portal-design.md`. |
| **directory** | tenant | `directory` | `apps/api/src/directory/directory.controller.ts`, `directory.service.ts`, `dto/resolve-directory.dto.ts` | TenantContext, Database | BFF/aggregation entity resolver: `POST /directory/resolve` bulk-resolves raw ids → display names for patients, doctors, wards, beds, items, orderItems, tests, imagingItems, invoices, employees, departments (see `DirectoryResolveResult`). No `@RequirePermission` (id-in/name-out only; caller already holds the ids). |

### Clinical (ADT & Encounters)

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **appointments** | tenant | `appointments` | `apps/api/src/appointments/appointments.controller.ts`, `appointments.service.ts`, `entities/appointment.entity.ts` | — | Booking & scheduling: CRUD + lifecycle transitions `check-in` (Scheduled→CheckedIn), `complete`, `no-show`, `cancel` (Complete/No-Show added recently), plus schedule lookups `GET /appointments/doctors/:doctorId/schedule` and `departments/:departmentId/schedule`. Same-doctor slot double-booking is closed by a partial unique index `UQ_appointments_active_doctor_slot`; department daily cap from `Department.maxDailyAppointments`. Permissions `appointment.manage`/`appointment.read`. Spec: `2026-07-31-appointment-scheduling-design.md`. |
| **clinical/vitals** | tenant | `vitals` | `apps/api/src/clinical/vitals/vitals.controller.ts`, `vitals.service.ts`, `entities/vital.entity.ts` | — | `POST /vitals`, `GET /vitals`, `GET /vitals/patient/:patientId`, `GET`/`PATCH /vitals/:id`, `DELETE /vitals/:id` (void = soft delete). BMI auto-computed from height/weight; ward-scoped access for staff with a `wardId` claim (active admission on that ward). Permissions `vitals.manage`/`vitals.read`. Spec: `2026-07-31-vitals-triage-design.md`. |
| **clinical/encounters** | tenant | `encounters` | `apps/api/src/clinical/encounters/encounters.controller.ts`, `encounters.service.ts`, `entities/{clinical-note,diagnosis,prescription}.entity.ts` | — | Clinical notes, diagnoses, prescriptions sub-resources (`/encounters/notes…`, `/diagnoses…`, `/prescriptions…` incl. `discontinue`/`complete`). Notes are Draft→Signed (locked once signed); diagnosis carries optional ICD-10; prescription status Active→Discontinued/Completed. Clinical author (`doctorId`) resolved from the JWT, never the caller. Permissions `encounter.manage`/`encounter.read`. Spec: `2026-07-31-clinical-encounter-design.md`. |
| **clinical/triage** | tenant | `triage/entries` | `apps/api/src/clinical/triage/triage.controller.ts`, `triage.service.ts`, `entities/triage-entry.entity.ts` | — | ER triage queue (`POST/GET /triage/entries`, `GET/PATCH :id`, `PATCH :id/link-patient` one-way). Severity = acuityLevel 1–5 + colorCode; lifecycle `Arrived/Triaged/In Treatment/Discharged/Admitted/Deceased`, closed entries locked; admissions admit with a source triage entry flips it to Admitted. Permissions `triage.manage`/`triage.read`. Spec: `2026-07-31-triage-design.md`. |
| **admissions** | tenant | `admissions` | `apps/api/src/admissions/admissions.controller.ts`, `admissions.service.ts`, `entities/{admission,bed-transfer,discharge-summary}.entity.ts` | — | ADT: admit, `GET /admissions/active`, `PATCH :id/transfer`, `PATCH :id/discharge`, discharge summaries CRUD + `review`. `Admission`→`BedTransfer` inserts also archive `PatientAdmitted`/`BedTransferred` reporting events. Permissions `admission.manage`/`admission.read`. Spec: `2026-07-31-admission-adt-design.md`. |
| **nursing** | tenant | `nursing` | `apps/api/src/nursing/nursing.controller.ts`, `nursing.service.ts`, `entities/nursing.entity.ts` | — | Inpatient nursing worklist: `tasks` (+ `start`/`complete`/`cancel`), MAR `administrations` (+ `administer`/`skip`), `handoff-notes` (+ `acknowledge`) — all three entity classes (`NursingTask`, `MedicationAdministration`, `ShiftHandoffNote`) in one file. Ward-scoped row access: scope-to-own-ward or assert ward access for an admission, from the account `wardId` claim. Permissions `nursing.manage`/`nursing.read`. |
| **ot** | tenant | `ot` | `apps/api/src/ot/ot.controller.ts`, `ot.service.ts`, `ot-surgery-number-generator.service.ts`, `entities/ot-surgery.entity.ts` | — | OT scheduling/execution: `POST/GET /ot/surgeries`, `GET :id`, and `start`/`complete`/`cancel` transitions; status machine `Scheduled → InProgress → Completed` (or `Cancelled` pre-start), room-conflict checks + active-room partial unique index. Surgery number via `ot_sequences` (prefix `SUR`). Permissions `ot.manage`/`ot.read`. |
| **maternity** | tenant | `maternity` | `apps/api/src/maternity/maternity.controller.ts`, `maternity.service.ts`, `entities/maternity-record.entity.ts` | — | Labor & delivery: one `MaternityRecord` per admission (antenatal fields gravida/para/LMP/EDD), one-way `POST /maternity/records/:id/delivery` sign-off (`deliveryType` Normal/C-Section/Instrumental) with the actor from the JWT. Permissions `maternity.manage`/`maternity.read`. |

### Orders & Diagnostics

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **orders** | tenant | `orders` | `apps/api/src/orders/orders.controller.ts`, `orders.service.ts`, `entities/{order,order-item}.entity.ts` | — | Order + order items (`itemType`: `'Lab'`, `'Radiology'`, `'Pharmacy'` or `'Other'`; **item-level** lifecycle only — the order header has no status — item status `'Pending'`, `'Completed'` or `'Cancelled'`). `POST/GET /orders`, `GET :id`, `PATCH :id/items/:itemId/{complete,cancel}` (only from `Pending`, pessimistic row lock). Completing an item is the choke point downstream modules call inside their own transactions (`completeItemInTransaction`) and is the trigger for charge capture, lab/radiology/pharmacy requisitioning and their order-cancellation subscribers (all three import `OrdersModule`). `Order` insert archives an `OrderPlaced` reporting event. Permissions `order.manage`/`order.read`. Spec: `2026-08-01-order-design.md`. |
| **lab** | tenant | `lab` (catalog) + `lab/requisitions` (workflow) | `apps/api/src/lab/lab-catalog.controller.ts`, `lab-workflow.controller.ts`, `lab-catalog.service.ts`, `lab-workflow.service.ts`, `lab-report-document.ts`, `lab-specimen-label-document.ts`, `lab-order-cancellation.subscriber.ts`, `lab-requisition-number-generator.service.ts`, `entities/{lab-test-category,lab-test,lab-test-component,lab-requisition,lab-result}.entity.ts` | Orders, Patients, @hospital/pdf, @hospital/object-storage | Catalog (categories/tests/components) + requisition lifecycle: create from order item, `collect-sample`, results entry, `verify`, `cancel`. Verified report PDFs are served (`GET :id/report.pdf`), printed as specimen labels (`GET :id/specimen-label.pdf`), and archived to object storage at `reports/lab/<requisitionNumber>.pdf`. Cancellation reacts via `lab-order-cancellation.subscriber.ts`. Permissions `lab.catalog.manage`, `lab.read`, `lab.requisition.create`, `lab.result.enter`, `lab.result.verify`. Specs: `2026-08-05-lab-lis-module-design.md`. |
| **radiology** | tenant | `radiology` (catalog) + `radiology/requisitions` (workflow) | `apps/api/src/radiology/radiology-catalog.controller.ts`, `radiology-workflow.controller.ts`, `radiology-catalog.service.ts`, `radiology-workflow.service.ts`, `radiology-report-document.ts`, `radiology-requisition-label-document.ts`, `radiology-order-cancellation.subscriber.ts`, `radiology-requisition-number-generator.service.ts`, `entities/{radiology-imaging-type,radiology-imaging-item,radiology-requisition}.entity.ts` | Orders, @hospital/pdf, @hospital/object-storage | Mirror of lab for imaging: catalog, requisitions, scan+report entry, verify; report PDFs archived at `reports/radiology/<requisitionNumber>.pdf`. Permissions `radiology.catalog.manage`, `radiology.read`, `radiology.requisition.create`, `radiology.report.enter`, `radiology.report.verify`. Specs: `2026-08-05-radiology-module-design.md`, `2026-08-25-dicom-scoping-design.md` (DICOM scoping — no DICOM store yet [per spec framing]). |
| **pharmacy** | tenant | `pharmacy/dispensings` | `apps/api/src/pharmacy/pharmacy-dispensing.controller.ts`, `pharmacy-dispensing.service.ts`, `pharmacy-dispensing-label-document.ts`, `pharmacy-dispensing-number-generator.service.ts`, `pharmacy-order-cancellation.subscriber.ts`, `entities/pharmacy-dispensing.entity.ts` | Inventory, Orders, @hospital/pdf | Dispensing records created from order items, `dispense` (decrements inventory), `cancel`, `reverse`; `GET /pharmacy/dispensings/pending-items` worklist; `GET :id/dispensing-label.pdf` label print. Permissions `pharmacy.read`, `pharmacy.dispensing.create`, `pharmacy.dispensing.dispense`. Spec: `2026-08-06-pharmacy-dispensing-design.md`. |

### Finance

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **billing** | tenant | `billing/invoices`, `billing/settings`, `billing/deposits` | `apps/api/src/billing/invoices.controller.ts`, `deposits.controller.ts`, `billing-settings.controller.ts`, `invoices.service.ts`, `deposits.service.ts`, `charge-capture.subscriber.ts`, `money.util.ts`, `entities/{invoice,invoice-item,payment,deposit,return,billing-settings,billing-sequence,numeric.transformer}.entity.ts` | Accounting | Invoices from charge capture: `ChargeCaptureSubscriber` watches `order_items` → `Completed` and calls `invoices.service.captureChargeForOrderItem` (best-effort; unpriced items skip; serialized per patient by advisory lock). Invoice statuses `Unpaid`/`PartiallyPaid`/`Paid`/`Cancelled`; invoice number is an integer per (INV prefix, April-start financial year) via `billing_sequences`; payment modes `Cash`/`Card`/`UPI`/`Cheque`/`Deposit`/`Insurance`; returns (credit notes) and invoice cancellation post contra-revenue journals (Sales Returns / Accounts Receivable). `POST /billing/invoices`, `POST .../charge-capture` (recovery), list/get, `PATCH :id/cancel`, `POST :id/payments`, `POST :id/returns`; deposits `POST /billing/deposits`, `PATCH :id/refund`; settings `GET`/`PATCH /billing/settings` (note: gated by `master-data.manage`, not a `billing.*` permission). Money is decimal Postgres `numeric`(…,2) via `numeric.transformer.ts` (parseFloat on read) + `roundMoney` — not integer paise. Invoice/payment/deposit/return inserts archive `InvoiceCreated`/`PaymentRecorded`/`DepositReceived`/`InvoiceReturned` reporting events. Permissions `billing.manage`/`billing.read`. Spec: `2026-08-01-billing-design.md`. |
| **insurance** | tenant | `insurance` | `apps/api/src/insurance/insurance.controller.ts`, `insurance-claims.service.ts`, `insurance-claim-number-generator.service.ts`, `entities/{insurance-payer,patient-policy,insurance-claim}.entity.ts` | Billing | Payers, patient policies (coverage window, sum insured, copay), reimbursement claims with lifecycle `Draft → Submitted → Approved → Paid` (or `Rejected`; endpoints `submit`/`approve`/`reject`/`pay`). Claim number `CLM-<year>-#####`; claims per invoice capped at its total (non-Rejected), approvals capped by policy `sumInsured` (row-locked); `pay` records an `Insurance`-mode payment against the invoice — the money movement lives in billing. Permissions `insurance.read`/`insurance.manage`. |
| **accounting** | tenant | `accounting` | `apps/api/src/accounting/accounting.controller.ts`, `accounting.service.ts`, `accounting-export.service.ts`, `accounting-csv.util.ts`, `accounting-reports-pdf-document.ts`, `journal-number-generator.service.ts`, `ledger-account-codes.ts`, `seed-ledger-accounts.ts`, `entities/{ledger-account,journal-entry}.entity.ts` | @hospital/pdf, @hospital/excel | Chart of accounts (`LedgerAccount`, 9 fixed system accounts with deterministic UUIDs in `ledger-account-codes.ts`), double-entry `JournalEntry`/`JournalLine` with manual Draft→Posted workflow and `AccountingService.postAutoJournal` (idempotent on sourceType+sourceId; drives billing/payroll/fixed-assets hooks; journal number `JRN-<year>-#####`). Reports `trial-balance`/`income-statement`/`balance-sheet`, each with `export.csv`/`export.pdf`/`export.xlsx` via `AccountingExportService` + `@hospital/excel`/`@hospital/pdf`. System ledger accounts seeded per tenant by `seedSystemLedgerAccounts` during provisioning. Permissions `accounting.read`/`accounting.manage`. |
| **payroll** | tenant | `payroll` | `apps/api/src/payroll/payroll.controller.ts`, `payroll.service.ts`, `entities/payslip.entity.ts` | Accounting | `POST /payroll/run` (monthly run: advisory lock `payroll:<month>:<year>`, snapshots Draft payslips for active employees — a payslip is a snapshot, not a live formula), `GET /payroll/payslips`, `GET :id`, `POST /payroll/payslips/:id/paid` (Draft→Paid: posts the payroll journal — Salary Expense debit / Salaries Payable credit — via `AccountingService.postAutoJournal` sourceType `Payslip`, same transaction). Permissions `payroll.read`/`payroll.manage`. |
| **fraction** | tenant | `fraction` | `apps/api/src/fraction/fraction.controller.ts`, `fraction.service.ts`, `fraction-reversal.subscriber.ts`, `entities/fraction.entity.ts` | — | Doctor incentive/revenue-share rules and per-invoice entries (`POST/GET /fraction/rules`, entries, `PATCH /fraction/entries/:id/reverse`). Entry base amount is server-resolved from the invoice's own `totalAmount` (never caller-supplied). `FractionReversalSubscriber` reacts to a `returns` insert and to an invoice updating to `Cancelled`, voiding live entries so a doctor is never paid a share of returned/voided revenue. Permissions `fraction.read`/`fraction.manage`. |
| **fixed-assets** | tenant | `fixed-assets` | `apps/api/src/fixed-assets/fixed-assets.controller.ts`, `fixed-assets.service.ts`, `fixed-asset-number-generator.service.ts`, `entities/{fixed-asset,fixed-asset-category,asset-depreciation-entry}.entity.ts` | Accounting | Asset register + categories + straight-line depreciation: stateless read valuation (`GET /fixed-assets/:id/valuation`), persisted monthly accrual run (`POST /fixed-assets/depreciation/run` writes `AssetDepreciationEntry` rows, one per asset+period) that posts Depreciation Expense / Accumulated Depreciation journals via `AccountingService.postAutoJournal` (sourceType `Depreciation`). Asset code `AST-<year>-#####`; valuation inputs frozen once entries exist. Permissions `fixed-asset.read`/`fixed-asset.manage`. |
| **reporting** | tenant | `reporting` | `apps/api/src/reporting/reporting.controller.ts`, `reporting-query.service.ts`, `reporting.subscriber.ts`, `persisting-reporting-event-publisher.ts`, `reporting-csv.util.ts`, `reporting-events-pdf-document.ts`, `entities/reporting-event.entity.ts` | TenantContext, Database, @hospital/pdf, @hospital/excel | Event archiver + analytics reads. `ReportingSubscriber` catches domain events (`OrderPlaced`, `InvoiceCreated`, `PaymentRecorded`, `DepositReceived`, `InvoiceReturned`, `PatientAdmitted`, `BedTransferred`) and writes a `Reporting`-kind `outbox_events` row on the SAME manager as the business transaction (atomic with it, per tenant schema) — a separate `outbox-dispatcher` compose service later materializes it into `reporting_events`, so dashboard reads lag the business write by up to the dispatcher's poll interval (default 5s). Endpoints: `GET /reporting/events`, `GET /reporting/dashboard/event-counts`, `GET /reporting/dashboard/revenue` (net revenue = `PaymentRecorded` − `InvoiceReturned`), plus CSV/PDF/xlsx exports of events and revenue (xlsx/pdf are the recent additions). Permissions `reporting.read`. Specs: `2026-08-01-reporting-archiver-design.md`, `2026-08-05-reporting-dashboard-read-apis-design.md`. |

### Supply Chain & Operations

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **inventory** | tenant | `inventory`, `inventory/requisitions`, `inventory/purchase-orders` | `apps/api/src/inventory/inventory-catalog.controller.ts`, `inventory-requisition.controller.ts`, `inventory-dispatch.controller.ts`, `inventory-procurement.controller.ts`, `inventory-catalog.service.ts`, `inventory-requisition.service.ts`, `inventory-procurement.service.ts`, `fefo-stock-decrement.service.ts`, `purchase-order-number-generator.service.ts`, `stock-requisition-number-generator.service.ts`, `entities/*` | MasterData | Catalog (category/sub-category/item/vendor), stock batches/balances/transactions, purchase orders + goods receipt, stock requisitions + dispatch (FEFO decrement). Three route namespaces: `inventory`, `inventory/requisitions` (create + dispatch), `inventory/purchase-orders`. Permissions: `inventory.catalog.manage`, `inventory.read`, `inventory.purchase-order.create`, `inventory.goods-receipt.enter`, `inventory.requisition.create`, `inventory.dispatch.fulfill`. Specs: `2026-08-05-inventory-procurement-design.md`, `2026-08-06-inventory-requisition-dispatch-design.md`. |
| **ward-supply** | tenant | `ward-supply` | `apps/api/src/ward-supply/ward-supply.controller.ts`, `ward-supply.service.ts`, `entities/ward-stock.entity.ts` | — | Ward sub-store stock: receive/consume/return/waste/adjust, `GET /ward-supply/stock`, `GET /ward-supply/transactions` (entities `WardStockBalance`, `WardStockBatch`, `WardStockTransaction`). Permissions `ward-supply.read`/`ward-supply.manage`. |
| **cssd** | tenant | `cssd` | `apps/api/src/cssd/cssd.controller.ts`, `cssd.service.ts`, `entities/cssd.entity.ts` | — | Central Sterile Supply: instrument register (+ `sterility` check), sterilization cycles with `complete`/`fail`. Permissions `cssd.read`/`cssd.manage`. |
| **ssu** | tenant | `ssu` | `apps/api/src/ssu/ssu.controller.ts`, `ssu.service.ts`, `ssu-case-number-generator.service.ts`, `entities/ssu-case.entity.ts` | — | Social service unit charity/subsidized-care cases (`POST/GET /ssu/cases`, `GET :id`, `approve`/`reject`/`close`); lifecycle `Open → Approved` or `Open → Rejected`, then `Closed` with a maker/checker split (the opener cannot approve), one open case per patient, subsidy percent 0–100; case number `SSU-<year>-#####`. Permissions `ssu.read`/`ssu.manage`. |
| **vaccination** | tenant | `vaccination` | `apps/api/src/vaccination/vaccination.controller.ts`, `vaccination.service.ts`, `entities/vaccination-record.entity.ts` | — | Vaccination records (`POST/GET /vaccination/records`, `GET :id`) — immutable per-dose administrations, no edit/delete or state machine; duplicate (patient, vaccine, dose) guarded; administered-by resolved from the JWT. Permissions `vaccination.read`/`vaccination.manage`. |

### HR

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **employee** | tenant | `employees` | `apps/api/src/employee/employee.controller.ts`, `employee.service.ts`, `employee-number-generator.service.ts`, `entities/employee.entity.ts` | — | Employee master CRUD + deactivate/reactivate; employee code `EMP-<year>-#####` via number generator; departmentId/designation are scalar columns validated by raw SQL (no ORM join); supplies payroll's active-employee base (`monthlyBasicSalary`). Permissions `employee.read`/`employee.manage`. |

### Communication & Engagement

| Module | Level | Route prefix(es) | Key files | Depends on | Notable |
|---|---|---|---|---|---|
| **notifications** | tenant | `notifications` | `apps/api/src/notifications/notifications.controller.ts`, `notifications.service.ts`, `notifications.subscriber.ts`, `entities/notification.entity.ts` | @hospital/auth-guards (`RequestContextFactory`) | In-app notifications (`@Entity('notifications')`, recipient-scoped). `NotificationsSubscriber` reacts to `Admission`/`Appointment` inserts and notifies the admitting doctor / booked doctor. Controller: `GET /notifications/summary`, `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/mark-all-read` — self-scoped to the JWT account. Permission `notification.read`. |
| **helpdesk** | tenant | `helpdesk` | `apps/api/src/helpdesk/helpdesk.controller.ts`, `helpdesk.service.ts`, `helpdesk-ticket-number-generator.service.ts`, `entities/helpdesk-ticket.entity.ts` | — | Internal ticketing: `POST/GET /helpdesk/tickets`, `GET :id`, transitions `assign`/`start`/`resolve`/`close`; requester/assignee display names joined in. Permissions `helpdesk.read`, `helpdesk.manage`, `helpdesk.create` (any staff can raise). |
| **marketing** | tenant | `marketing` | `apps/api/src/marketing/marketing.controller.ts`, `marketing.service.ts`, `entities/marketing.entity.ts` | — | Referral sources + patient referrals (`ReferralSource`, `PatientReferral`). Permissions `marketing.read`/`marketing.manage`/`marketing.create`. |

### Not a feature module

- `apps/api/src/app/` — `AppModule`, global validation pipe, wiring/`mvp-workflow` integration specs.
- `apps/api/src/database/` — data-source, tenant connection/provisioning, migrations, seed
  runners, sequence-number generator, audit-columns subscriber (see Database & tenancy).
- `apps/api/src/testing/` — `tenant-test-context.ts`, `test-jwt.ts` (see Seeds & tests).
- `apps/api/src/assets/` — Swagger favicon/icons copied by webpack.

---

## Database & tenancy

- **One Postgres database, one schema per tenant.** Schema and role are both named
  `tenant_<id>` (regex-guarded `/^tenant_[a-z0-9_]+$/`). Per-request routing is done by
  `TenantConnectionService.runInTenantSchema(work)` in
  `apps/api/src/database/tenant-connection.service.ts`: it checks out a `QueryRunner`, starts a
  transaction, then issues `SET LOCAL ROLE "tenant_<id>"` and `SET LOCAL search_path TO
  "tenant_<id>", public` before running the work — `SET LOCAL` is transaction-scoped so pooled
  connections can never leak another tenant's `search_path`/role. Data access outside that helper
  reads the plain injected `DataSource` (used for public-schema catalog entities and by platform
  flows).
- **Provisioning.** `apps/api/src/database/tenant-provisioning.service.ts` creates the schema +
  NOLOGIN role, grants default privileges, runs every `TENANT_MIGRATIONS` entry against the new
  schema via a dedicated migration DataSource (`tenant-migration-data-source.ts`, which connects
  with `-c search_path=<schema>,public`), seeds the system chart of accounts
  (`accounting/seed-ledger-accounts.ts`), then grants table/sequence privileges and makes
  `hospital_db_user` a member of the tenant role. Called by `TenantsService` and the test helper.
- **Entities.** Every feature module owns its entities under `apps/api/src/<module>/entities/`.
  Real business/clinical/financial records extend `AuditableEntity`/`SoftDeletableEntity`
  (`database/auditable.entity.ts`) → automatic `createdBy/updatedBy` (and `deletedBy` on soft
  delete) filled by `AuditColumnsSubscriber` (`database/audit-columns.subscriber.ts`) from the
  tenant context. Entity registration for the app DataSource is centralized in
  `database/data-source.ts` (full entity import list = module inventory).
- **Migrations.** `database/migrations/index.ts` splits two immutable baselines: `PLATFORM_MIGRATIONS`
  (`0093-initial-platform-schema`) run once by `migrate.ts`; `TENANT_MIGRATIONS`
  (`0094-initial-tenant-schema` + `0095…0098` appends) run per tenant by provisioning and by
  `migrate-tenants.ts` (backfills existing tenant schemas; skips purged/missing schemas).
  History 0001–0092 was squashed into the two baselines on 2026-08-27 (Development-Standards §108).
- **Money & numeric columns** use Postgres `numeric`; `billing/entities/numeric.transformer.ts`
  parses strings to floats on read. Reporting/audit tables `reporting_events`/`audit_records` live
  in each tenant schema.
- **Outbox:** reporting/audit writes go through a tenant-scoped `outbox_events` table first (same
  manager/transaction as the business write, guaranteeing atomicity), drained into
  `reporting_events`/`audit_records` by a separate `outbox-dispatcher` compose service on its own
  connection (`database/outbox-dispatcher-entrypoint.ts`) — see Development-Standards.md §140. Both
  are therefore eventually consistent with the business write (lag up to the dispatcher's poll
  interval, default 5s), not real-time.

---

## Seeds & demo data

All seed entrypoints are nx targets on the `api` project (defined in `apps/api/package.json` under
`nx.targets`) and standalone runner files under `apps/api/src/database/`:

| Target / runner | Populates |
|---|---|
| `api:migrate` (`src/database/migrate.ts`) | Runs `PLATFORM_MIGRATIONS` (public-schema platform tables). |
| `api:migrate-tenants` (`src/database/migrate-tenants.ts`) | Applies pending `TENANT_MIGRATIONS` to every existing tenant schema (idempotent; 3-fold guard against purged/missing schemas). |
| `api:seed-rbac` (`database/seed-rbac-catalog-runner.ts`) | Upserts the role catalog (14 roles), permission catalog (79 strings) and role→permission mappings from `rbac/seed-rbac-catalog.ts` into the public schema. |
| `api:seed-packages` (`database/seed-packages-catalog-runner.ts`) | Upserts `basic`/`standard`/`enterprise` package rows (`packages/seed-packages-catalog.ts`). |
| `api:seed-ledger-accounts` (`database/seed-ledger-accounts.ts`) | Seeds the system chart of accounts (idempotent upsert). Also runs automatically during tenant provisioning (`accounting/seed-ledger-accounts.ts`). |
| `api:seed-initial-setup` (`database/seed-initial-setup-runner.ts`) | Provisions + activates the reserved `__platform` tenant with **Super Admin** (`superadmin`, default creds env-overridable) and the `demo` hospital tenant with **Hospital Admin** (`demoadmin`); enables the full catalog role set; seeds ledger accounts. Env: `PLATFORM_ADMIN_*`, `MASTER_ADMIN_*`. |
| `api:seed-demo-catalog` / `api:seed-demo-data` (`database/seed-demo-data.ts`) | Realistic demo-hospital dataset in the `demo` tenant: ward/beds, master catalogs, patients, appointments, full visit record (vitals + encounter), an admission, an order driven through Lab/Pharmacy/Radiology completion (exercising real charge capture into an invoice), employees and a payroll run, plus demo staff accounts (doctor/nurse/receptionist/pharmacist/billing/HR/helpdesk/auditor — see `70671fb`). Passwords env-overridable (`DEMO_*_PASSWORD`). |
| `api:seed-all` | Chains `migrate` then the catalog/demo seeds (see the target command in `apps/api/package.json`). |
| docker-compose `seed-rbac`, `seed-initial-setup`, `seed-all` services | Same targets run inside compose (`profiles: ['seed']`). |

Demo/dev accounts (defaults in code, overridable): `superadmin` / `demoadmin` and per-role demo
accounts with passwords such as `DemoAdmin@123!`, `SuperAdmin@123!`, `Doctoruser@123!`,
`Nurseuser@123!`, `Receptionist@123!`, `Accountuser@123!`, `Demo@123!`.

---

## Cross-references

- [Technical-Design.md](./Technical-Design.md) — architecture overview (system summary, tenancy
  mechanism, request lifecycle, cross-cutting concerns).
- [DEPLOYMENT.md](../../code/DEPLOYMENT.md) and [Deployment-Guide.md](./Deployment-Guide.md) —
  deploy/ops guidance.
- [Runbook.md](./Runbook.md) — operational runbooks (provisioning failures, backup/recovery).
- [Development-Standards.md](./Development-Standards.md) — coding/architecture/test conventions.
- [PRD.md](./PRD.md) — product requirements & phasing (domain vocabulary).
- [mvp-status.md](./mvp-status.md), [pending-tasks.md](./pending-tasks.md),
  [review-comments.md](./review-comments.md) — build-status/backlog/gap records.
- Per-module design specs: `backend/docs/superpowers/specs/` (linked per module above); matching
  implementation plans under `backend/docs/superpowers/plans/`.
- [backend/code/CLAUDE.md](../../code/CLAUDE.md) — workspace conventions for code under
  `backend/code`.

Last verified against commit `1d6b01e 2026-09-02`.
