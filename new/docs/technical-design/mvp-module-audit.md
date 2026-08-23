# MVP Module Audit: RBAC, Pagination & Audit Log Support

This document details a codebase-wide audit of all modules in the NestJS backend (`new/code/apps/api/src/*`) for Role-Based Access Control (RBAC), pagination practices, and audit log support, along with bugs identified and resolved.

---

## 1. Module Classification & Risk Tiers

To make module-level decisions, we group the system's ~37 active modules into three distinct risk tiers based on data sensitivity, financial auditability, and clinical safety:

| Tier | Sensitivity & Risk | RBAC Requirements | Pagination Requirements | Audit Trail Requirements |
|---|---|---|---|---|
| **Tier 1 (High)** | **Clinical, Financial, Identity & Access**<br>*Example: Patient data, Billing, Lab, Radiology, Auth* | Strict granular permissions required for all endpoints. | Strict page/limit pagination using `@hospital/pagination` for all list/search queries. | Full audit logs via `AuditableEntity` / `SoftDeletableEntity` TypeORM hooks. |
| **Tier 2 (Med)** | **Operations, Inventory, Ward Logs**<br>*Example: Employee, Stock Requisitions, SSU, Helpdesk* | Standard permission guards for read/write. | Required for potentially unbounded lists (requisitions, tickets, referrals). | Audited for creation, edits, and status changes. |
| **Tier 3 (Low)** | **Lookups, Static Reference Data, Platform Config**<br>*Example: Wards, Departments, Branding, Packages* | Platform-admin guards or read-only/lookup roles. | Optional or bypassed for small, finite static catalogs (<100 rows). | Standard database logging; excluded for the `audit` module to prevent cycles. |

---

## 2. Module Audit Decisions & Status

Below is the module-by-module audit and compliance analysis:

### Tier 1: High Risk (Clinical, Financial, Auth)

1. **`auth` / `accounts` / `rbac` (Identity & Access)**
   - **RBAC**: Fully compliant. Routes are guarded with `PermissionGuard` and `rbac.manage` or equivalent.
   - **Pagination**: `/accounts` uses manual limit/offset pagination to match frontend plain array expectation. `AccountsController.list` was found vulnerable to `NaN` inputs and has been hardened (see section 3).
   - **Audit Logs**: Fully compliant. `Account`, `Role`, and `Permission` entities extend `AuditableEntity` and mutations are tracked.
2. **`patients` / `appointments` / `admissions` (ADT)**
   - **RBAC**: Guarded by `patients.read`, `patients.create`, `patients.update`, `patients.manage`, `admissions.read`, `admissions.manage`.
   - **Pagination**: Patients search, appointments list, and admissions list use `@hospital/pagination`'s `paginate()`.
   - **Audit Logs**: Fully compliant. Entities inherit from `SoftDeletableEntity`. Deactivation uses subscriber-friendly soft removal.
3. **`clinical/vitals` / `clinical/encounters` / `clinical/triage` (EMR)**
   - **RBAC**: Guarded by `encounter.read`, `encounter.manage`, and `triage.read`/`triage.manage`.
   - **Pagination**: Triage uses `paginate()`. Vitals, encounters notes, diagnoses, and prescriptions are scoped to a specific `patientId` (naturally bounded patient chart timelines) and do not need large-scale pagination.
   - **Audit Logs**: Fully compliant. Soft delete paths use TypeORM's `softRemove` to trigger subscriber hooks.
4. **`billing` / `platform-billing` (Finance & SaaS Billing)**
   - **RBAC**: Guarded by `billing.read`/`billing.manage` and `system-admin.tenants.manage`.
   - **Pagination**: Invoices and deposits lists extend `PaginationQueryDto` and use `paginate()`. Platform billing lists are small-scale tenant lists.
   - **Audit Logs**: Highly critical and fully audited. Invoices and deposits mutations trigger subscriber hooks and use advisory write locks for concurrency control.
5. **`lab` / `radiology` (LIS & RIS Workflow)**
   - **RBAC**: Guarded by `lab.read`/`lab.verify` and `radiology.read`/`radiology.report.verify`.
   - **Pagination**: All list endpoints extend `PaginationQueryDto` and use `paginate()`.
   - **Audit Logs**: Fully audited. Completed requisitions emit billing charges automatically via the `ChargeCaptureSubscriber`.
6. **`pharmacy` (POS Dispensing)**
   - **RBAC**: Guarded by `pharmacy.read`, `pharmacy.dispense`, `pharmacy.catalog.manage`.
   - **Pagination**: Dispensing queues extend `PaginationQueryDto` and use `paginate()`.
   - **Audit Logs**: Fully audited. Controlled substances and cash register sales track audit metadata.
7. **`accounting` (GL / double-entry journals)**
   - **RBAC**: Guarded by `accounting.read` / `accounting.write`.
   - **Pagination**: Journals list extends `PaginationQueryDto` and uses `paginate()`. Ledger accounts list returns the static Chart of Accounts (small cardinality) and is not paginated.
   - **Audit Logs**: Fully audited double-entry bookkeeping ledger.
8. **`insurance` / `payroll` / `maternity` / `cssd` (Clinical & Operations)**
   - **RBAC**: Guarded by `insurance.read`/`insurance.manage`, `payroll.read`/`payroll.manage`, `maternity.read`/`maternity.manage`, `cssd.read`/`cssd.manage`.
   - **Pagination**: All list endpoints extend `PaginationQueryDto` and use `paginate()`.
   - **Audit Logs**: Fully audited entities.

### Tier 2: Medium Risk (Operations & Logs)

9. **`employee` / `ward-supply` / `nursing` / `ot`**
   - **RBAC**: Guarded by standard permissions (`employee.read`, `ward-supply.manage`, `nursing.read`, `ot.read`).
   - **Pagination**: All list endpoints extend `PaginationQueryDto` and use `paginate()`.
   - **Audit Logs**: Fully compliant.
10. **`ssu` / `vaccination` / `helpdesk` / `marketing`**
    - **RBAC**: Guarded by `ssu.read`, `vaccination.read`, `helpdesk.read`, `marketing.read`.
    - **Pagination**: Lists extend `PaginationQueryDto` and use `paginate()`.
    - **Audit Logs**: Fully compliant.
11. **`inventory` (Procurement, Requisition, Dispatch)**
    - **RBAC**: Guarded by `inventory.read` and `inventory.manage`.
    - **Pagination**: Active purchase orders, stock balances, and department requisitions use `paginate()`.
    - **Audit Logs**: Fully compliant.
12. **`notifications` (User-scoped Notifications)**
    - **RBAC**: Class-level `PermissionGuard` is active. Methods are user-scoped (they read the caller's own account ID from the JWT context) and do not require administrative permissions.
    - **Pagination**: Uses `paginate()` with `SearchNotificationsDto` (extends `PaginationQueryDto`).
    - **Audit Logs**: Read/unread updates are tracked.

### Tier 3: Low Risk (System Config & Static Lookups)

13. **`master-data` (Departments, Wards, Beds)**
    - **RBAC**: Read-only endpoints are accessible to all authenticated staff (`master-data.read`). Creation/deactivation requires `master-data.manage` (Super Admin or Platform Admin).
    - **Pagination**: Bypassed by design. Wards (<50), departments (<100), and beds (<30 per ward) have low cardinality, making client-side caching of these lists cleaner than paginated fetching.
    - **Audit Logs**: Edits to the department and ward catalog structure are fully audited.
14. **`platform-branding` (Tenants Whitelabeling)**
    - **RBAC**: Platform-facing endpoints require `system-admin.tenants.manage`. The tenant-facing public branding endpoint (`GET /branding`) is deliberately unguarded so the login page can load assets pre-session.
    - **Pagination**: Not required (single branding config per tenant).
    - **Audit Logs**: Persists logos to MinIO and branding rows to the platform schema, fully audited.
15. **`packages` / `tenants` / `platform-billing` (SaaS Management)**
    - **RBAC**: Protected by `system-admin.tenants.manage` (Super Admin only).
    - **Pagination**: Low-volume lists.
    - **Audit Logs**: Fully audited. Purge sequences drop schemas atomically inside transactions.
16. **`reporting` (Aggregated Event Reports)**
    - **RBAC**: Guarded by `reporting.read`.
    - **Pagination**: `/reporting/events` uses manual page/limit parameters to match the frontend expectation (`{ items, total }` instead of `{ data, meta }`). Hardened to prevent `NaN` inputs (see section 3).
    - **Audit Logs**: Excluded. As the event archiver consumer, it only reads from logged database events.
17. **`audit` (Audit Log Query UI)**
    - **RBAC**: Guarded by `audit.read` (Super Admin/Compliance Auditor).
    - **Pagination**: Search endpoint extends `PaginationQueryDto` and uses `paginate()`.
    - **Audit Logs**: The `AuditRecord` entity is decorated with `@AuditExclude` to prevent infinite write cycles of audit records auditing audit writes.

---

## 3. Bugs Identified & Fixed

During this audit, we identified two pagination-related bugs that could crash the application (500 Internal Server Error) when malformed input was provided:

### 1. Accounts Controller `NaN` Parameter Crash
- **File**: `new/code/apps/api/src/accounts/accounts.controller.ts`
- **Bug**: The `list` query endpoint passed raw `@Query('limit')` and `@Query('offset')` parameters to `Number()`. If the query parameter was a string like `limit=foo`, it resolved to `NaN`. Passing `NaN` to TypeORM's `take` and `skip` parameters generated invalid SQL syntax, causing the database query to fail.
- **Fix**: Replaced the direct `Number()` conversion with safe parsing:
  ```typescript
  const parsedLimit = limit && !isNaN(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 50;
  const parsedOffset = offset && !isNaN(Number(offset)) ? Math.max(0, Number(offset)) : 0;
  ```
  This sanitizes the input, defaults `NaN` values to standard limits, and prevents SQL exceptions.

### 2. Reporting Controller `NaN` Parameter Crash
- **File**: `new/code/apps/api/src/reporting/reporting.controller.ts`
- **Bug**: Similar to the accounts controller, the `listEvents` query endpoint parsed `page` and `limit` with `Number(page)` and `Number(limit)` and passed them directly to the query service. Malformed string inputs resulted in `NaN`, which caused `qb.skip((page - 1) * limit).take(limit)` in `ReportingQueryService` to fail with invalid SQL.
- **Fix**: Hardened the parameter extraction in the controller:
  ```typescript
  const parsedPage = page && !isNaN(Number(page)) ? Math.max(1, Number(page)) : 1;
  const parsedLimit = limit && !isNaN(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 50;
  ```
  This guarantees that positive, valid integers reach the query execution block, preventing database crashes.

### 3. Tenant Purge Audit-Trail Bypass
- **File**: `new/code/apps/api/src/tenants/tenants.service.ts`
- **Bug**: When a tenant is hard-purged, its status in the tenant registry is updated to `'purged'`. However, this was implemented using `repository.update()`, which executes a direct query and bypasses TypeORM's entity subscribers. As a result, the tenant purge status transition was never recorded in the audit trail.
- **Fix**: Replaced the direct `.update()` call with `.save()` on the loaded tenant entity instance:
  ```typescript
  tenant.status = 'purged';
  tenant.purgedAt = new Date();
  await manager.getRepository(Tenant).save(tenant);
  ```
  This forces the update through the `AuditSubscriber` pipeline, ensuring that every tenant purge is permanently logged for compliance and security auditing.

### 4. Admissions Controller In-Memory Discharge Summary Lookup
- **File**: `new/code/apps/api/src/admissions/admissions.controller.ts`
- **Bug**: To fetch a single discharge summary by ID, the controller endpoint loaded *all* discharge summaries for the entire tenant using `listDischargeSummaries()`, then performed an in-memory `.find(s => s.id === id)` search. This is an O(N) memory and CPU performance bottleneck that scales poorly as the database grows.
- **Fix**: Added a dedicated `getDischargeSummary(id)` method to `AdmissionsService` to perform a direct O(1) indexed SQL lookup, and updated the controller to call it directly.
