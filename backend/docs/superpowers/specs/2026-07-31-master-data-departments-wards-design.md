# Master Data — Departments and Wards — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§5.1, §6.1, §8 Phase 0)
**Supersedes (partially):** `2026-07-30-master-data-service-design.md`, which assumed a separate microservice with its own Postgres instance and a Redis read-through cache fronting a network API. Under the 2026-07-31 modular-monolith pivot, Master Data is a domain module inside `apps/api`, consumed via direct in-process calls — no network hop, no cache needed yet (deferred until there's a proven need; in-process reads are already fast).

## Scope

First slice of Master Data: `departments` and `wards`, the two tables Phase 1's clinical modules (Patient, Appointment/Scheduling, Admission) will reference almost immediately. **Explicitly deferred**, no consumer yet:
- The generic `lookups` (jsonb) registry.
- All platform-level bulk reference data (`states`, `districts`, `icd10_codes`, `payment_modes`) — better seeded closer to when a real consumer needs it (Patient's address form, Clinical/EMR's diagnosis coding).

## Data model

Both tables are per-tenant (inside `tenant_<hospitalId>`, same pattern as `accounts`) — their migration is added to `AccountsService.provisionTenantSchema`'s per-tenant migration list, not `data-source.ts`'s platform-level list.

| Table | Key fields | Notes |
|---|---|---|
| `departments` | `id`, `departmentCode` (unique per tenant), `departmentName`, `description`, `isActive`, `isAppointmentApplicable`, `parentDepartmentId` (nullable self-reference), `roomNumber`, `noticeText` | Deliberately drops two fields the old `DepartmentModel` had: `DepartmentHead` (a direct FK to an employee) and the OPD/followup service-item FKs into Billing. Both are cross-module references baked into a master-data table in the old design — exactly the "no enforced ownership boundary" problem PRD §1 calls out. Other modules reference `departmentId` by value only, never a live FK. |
| `wards` | `id`, `wardCode` (unique per tenant), `wardName`, `wardType`, `bedCapacity`, `isActive` | Ward *definition* (master data) is distinct from Ward Supply Service's stock/requisition data (a later phase) — this table is just the ward catalog other modules reference by ID. |

## Permission model

Single permission, `master-data.manage`, covering both departments and wards (same "one permission per domain" pattern as `identity.accounts.manage` and `system-admin.tenants.manage`). Granted to **both Hospital Admin and Super Admin** — unlike the tenant registry (Super Admin only, a cross-hospital ops action), department/ward management is per-hospital admin territory per PRD §6.1 ("Hospital Admin: ... Master Data").

## Error handling

- Creating a department/ward with a `departmentCode`/`wardCode` that already exists within the tenant → 409.
- Deactivating a department that's still referenced as `parentDepartmentId` by an active child department → 409 (matches the original design's stated rule).
- Referencing a `departmentId`/`wardId` from another module that doesn't exist or is inactive is that module's own validation responsibility — Master Data doesn't enforce referential integrity across module boundaries (cross-module references are opaque IDs, not live FKs, per G2).

## Testing

- Cross-tenant isolation (same category as every other per-tenant module's test).
- Duplicate-code rejection (409) for both departments and wards.
- Parent-department-with-active-child deactivation rejection (409).
- Permission gating: both Hospital Admin and Super Admin permitted; every route 403s without `master-data.manage`.
