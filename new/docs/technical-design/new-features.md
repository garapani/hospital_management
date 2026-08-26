# Pending Additions and New Features

This list is based on the current technical design review plus the PRD open questions. It separates implementation gaps from future product modules.

## Must Add Before Production

### 1. JWT-backed request authentication and authorization

Current protected routes still trust headers such as `x-tenant-id` and `x-permissions`. Add a real JWT guard that:

- Validates `Authorization: Bearer <token>` on protected routes.
- Derives `accountId`, `hospitalId`, `roles`, `permissions`, and `patientId` from verified JWT claims.
- Replaces client-controlled permission and tenant headers for application security decisions.
- Keeps temporary header-based behavior only for tests/dev if explicitly documented.

Related review comments: `review-comments.md` authorization finding.

### 2. Database-enforced tenant isolation

The docs promise Postgres-level tenant isolation, but the current code uses one DB user and `SET search_path`. Add one of these enforcement models:

- Per-tenant DB roles with schema grants and controlled role switching.
- Or a consciously documented alternative, such as a single role plus stricter application checks, if DB grants are deferred.

Required additions:

- Tenant provisioning must create/apply schema permissions.
- Migrations must preserve grants for each tenant schema.
- Integration tests must prove one tenant cannot read another tenant's schema even if the application sets the wrong tenant context.

### 3. Nx module-boundary enforcement

The architecture depends on logical bounded contexts, but lint enforcement is not wired yet. Add:

- ESLint flat config.
- Nx project tags per domain or layer.
- `@nx/enforce-module-boundaries` rules.
- CI `lint` target.
- At least one negative test or documented example showing forbidden cross-domain imports.

### 4. Production deployment path

The deployment guide is ahead of the implementation. Add or fix:

- Correct environment variable names: `DB_USERNAME`, `DB_DATABASE`, `DB_HOST`, `DB_PORT`, `DB_PASSWORD`, `JWT_SECRET`.
- A clear migration command or startup migration strategy.
- Correct build output path and production start command.
- Production Dockerfile and production `docker-compose.yml`.
- A secret handling pattern for production.

### 5. Shared integration-test tenant helper

The docs describe a shared `inTenant()` helper, but tests currently define local helpers. Add a real test utility that:

- Creates or reuses a test tenant schema.
- Runs code inside `TenantContextService.run(...)`.
- Offers predictable cleanup.
- Defines whether tests are transaction-rollback based or schema-drop based.
- Documents how audit/reporting subscribers behave in tests.

## Operational Additions

### 6. Backup and restore runbooks

Add concrete runbooks for:

- Full Postgres backup and restore.
- Per-tenant schema restore.
- WAL/archive configuration, if used.
- Offsite backup sync.
- Restore verification drills.

### 7. Hardware failure recovery plan

The PRD requires offsite backups but does not define recovery mechanics. Add:

- Target recovery time.
- Spare hardware or hosting fallback plan.
- Step-by-step rebuild procedure.
- DNS/reverse-proxy cutover steps.
- Owner and escalation path.

### 8. Reference server sizing and load test

Before hosted onboarding, add:

- Reference CPU/RAM/disk profile.
- Load-test scenarios for 10-20 tenants.
- Baseline API latency, DB CPU, DB connections, and storage growth.
- Noisy-neighbor test cases for reporting/import-heavy tenants.

### 9. Connection pooling and tenant limits

Add PgBouncer or equivalent pool configuration:

- Global and per-tenant connection caps.
- Statement timeouts for expensive queries.
- Query metrics tagged by tenant.
- Alerts for noisy-neighbor behavior.

### 10. Observability stack

The PRD names OpenTelemetry, Prometheus, Grafana, and Loki. Add:

- Application metrics endpoint.
- Structured logs with correlation ID and tenant ID.
- Trace instrumentation for API, DB calls, and key domain operations.
- Dashboards and alert rules.

## Platform Features Still Needed

### 11. Redis integration

The PRD lists Redis for sessions, rate limiting, master-data cache, and permission cache invalidation. Add:

- Redis container/config.
- Rate limiting.
- Permission cache with invalidation on role/permission changes.
- Master-data read-through cache, if still desired.

### 12. MinIO/object storage integration

The PRD lists MinIO for DICOM, PDF reports, Excel exports, and documents. Add:

- Object storage client module.
- Per-tenant object namespace policy.
- Upload/download APIs.
- Backup policy for object data.

### 13. Reporting dashboard read APIs

The event archiver exists as capture-only. Add later:

- Reporting query endpoints.
- Dashboard aggregation models.
- RBAC for reporting/audit readers.
- Export endpoints for government or operational reports.

### 14. India compliance roadmap

Billing has GST-oriented behavior, but the broader adapter roadmap is still open. Add product specs for:

- GST invoice compliance finalization.
- ABHA/ABDM integration trigger and scope.
- PM-JAY integration trigger and scope.
- ESI/PF integration trigger and scope.

### 18. Real doctor availability/scheduling model

`AppointmentsService.getDoctorSchedule()` assumes a fixed 16-slot day ("8-hour workday with
30-minute slots") — there's no doctor working-hours/shift model anywhere in the codebase; `doctorId`
is just a raw UUID with no profile or schedule entity behind it. The appointment-conflict checks in
`create()`/`update()` inherit the same blind spot: they only check for an exact double-booked slot,
never whether a doctor is even scheduled to work that day/time. Add:

- A doctor availability/schedule entity: working days, shift hours, per-doctor or per-department
  slot duration.
- Exception handling: leave, one-off unavailability, holiday overrides.
- `getDoctorSchedule()` computing real bookable slots from that model instead of the hardcoded
  constant.
- `create()`/`update()` conflict checks validating the requested slot falls within the doctor's
  actual availability, not just checking for an exact double-booking.

Related review comments: code-review-findings-2026-08-25.md, appointments module, P2
(`appointments.service.ts:165-187`).

### 19. Apply an approved SSU subsidy to Billing

`SsuService` validates `subsidyPercent` (0-100) on `openCase` and records it on the case, but
nothing applies it: an Approved case's write-off never reaches any invoice, so Billing has no
idea the case exists. Applying it means touching the invoice money math and the revenue journal:

- A subsidy amount derived from the patient's Approved (not yet Closed) SSU case at invoice
  total-computation time — `InvoicesService.create()` (manual invoices), and the open-invoice
  recompute in `captureChargeForOrderItem()` — plus the return path (`createReturn()`) so a
  subsidized invoice reverses correctly.
- A contra/discount journal for the write-off portion (the current charge-capture journal books
  the full line amount), and the invoice-status recompute (`paidAmount >= totalAmount`) staying
  correct when a subsidy is later closed.
- A decision on interaction with manual line `discountAmount`, the still-open 0% tax capture
  gap, and whether a closed subsidy retroactively re-prices outstanding invoices.

Related review comments: code-review-findings-2026-08-25.md, ssu module, P2
(`ssu.service.ts:72`).

## Product Module Backlog

The PRD phases still leave these major domains to add:

- Phase 2: Lab/LIS, Radiology, DICOM, Pharmacy, Inventory, Ward Supply.
- Phase 3: Insurance/Claims, Accounting, Verification, Fixed Asset.
- Phase 4: Clinical/EMR long tail, Nursing, Emergency, OT, Maternity, CSSD.
- Phase 5: Employee, Payroll, Fraction and Incentive.
- Phase 6: Helpdesk, Marketing and Referral, Social Service Unit, Notification, Document and Print, full Reporting/Dashboard.

## Documentation Cleanup

### 15. Separate current-state docs from target-state docs

Some docs describe intended architecture while the implementation is still catching up. Add clear labels:

- Current implementation state.
- Target architecture.
- Known temporary shortcuts.
- Production blockers.

### 16. Fix moved-path references

After moving docs into `new/docs/technical-design/`, update internal references such as:

- `docs/superpowers/specs/...`
- `docs/architecture-decision-records/...`

Use either repo-root-relative paths consistently or correct relative links such as `../superpowers/specs/...`.

### 17. Update runbook and deployment guide

Keep operator docs literal and current:

- Remove claims that migrations run automatically unless implemented.
- Use the actual build output path.
- Use correct Docker Compose command format for the repo layout.
- Document audit/reporting failure behavior based on current subscriber implementation.
