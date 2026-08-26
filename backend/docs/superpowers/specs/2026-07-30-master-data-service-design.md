# Master Data Service — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§5.1, §8 Phase 0)
**Old-system source (field inspiration only, not a parity contract — see PRD line 6):** `old/hospital-management-emr/Code/Components/DanpheEMR.ServerModel/MasterModels/*` (`DepartmentModel`, `Country`/`CountrySubDivision`/`Municipality`, `ICD10Code`, `CoreCFGLookupModel`), `Core/Lookups`, `Core/Parameters`

## Scope

Owns hospital-wide reference data used by many other services: departments, wards, standard code tables (ICD10, geography, payment modes), and per-hospital generic lookups. Phase 0 service (§8) — clinical and billing services depend on this data existing before they can meaningfully operate.

## Data model

Like System Admin Service, this service's Postgres instance has two layers — platform-level shared reference data, and per-tenant hospital-managed data. Unlike System Admin's split (which exists for a chicken-and-egg provisioning reason), this split exists because some reference data is genuinely identical across every hospital and shouldn't be duplicated 10-20+ times or drift out of sync when it's updated.

### Platform-level (shared across all tenants, read-mostly, maintained centrally)

| Table | Key fields | Notes |
|---|---|---|
| `states` | state_code, state_name | India only (PRD §1 — this build targets India, not Nepal). |
| `districts` | district_code, district_name, state_id | State + District + a free-text PIN code field on the address itself is sufficient granularity (not full LGD state/district/sub-district/village) — matches what most Indian hospital systems capture, and full LGD granularity is only needed for ABHA/ABDM, which is explicitly deferred (PRD §3). |
| `icd10_codes` | icd10_id, short_code, code, description, valid_for_coding, is_active | Directly reusable from old `ICD10CodeModel` — this is standard-body data, identical for every hospital. |
| `payment_modes` | mode_code, mode_name, is_active | Closed set for Phase 0 (Cash, Card, UPI, Cheque, Bank Transfer, Insurance) — hospitals don't need to customize this list. |

**Note:** the old system's `TaxModel` (Nepal VAT-era) is **not** carried into Master Data — India's GST logic belongs to the India Compliance Adapter (PRD §5.7), not a generic master-data tax table.

### Per-tenant (inside `tenant_<hospitalId>`, hospital-managed)

| Table | Key fields | Notes |
|---|---|---|
| `departments` | department_code, department_name, description, is_active, is_appointment_applicable, parent_department_id, room_number, notice_text | Deliberately drops two fields the old `DepartmentModel` had: `DepartmentHead` (a direct FK to an employee) and `OpdNewPatientServiceItemId`/`OpdOldPatientServiceItemId`/`FollowupServiceItemId` (direct FKs into Billing's service-item catalog). Both are cross-service references baked into a master-data table in the old design — exactly the "no enforced ownership boundary" problem the PRD calls out in §1. In the new design: Employee Service (Phase 5) references `departmentId` from its own side if it needs to track a department head; Billing Service holds its own department→service-item price mapping, referencing `departmentId` by value only, never a live FK. |
| `wards` | ward_code, ward_name, ward_type, bed_capacity, is_active | Ward *definition* (master data) is distinct from Ward Supply Service's stock/requisition data (§5.2) — this table is just the ward catalog other services reference by ID. |
| `lookups` | lookup_id, module_name, lookup_name, lookup_data (jsonb), description, is_active | Generic per-hospital extensible lookup registry — directly modeled on the old `CoreCFGLookupModel` (ModuleName/LookUpName/LookupDataJson), which already solved "avoid a new physical table for every small static list" (blood groups, reaction types, marital status, etc.). `jsonb` instead of a raw string, since this is Postgres. |

## Consumption pattern

Every consuming service reads Master Data via its API (never direct SQL, per G2) and caches read-mostly data locally (Redis read-through cache, per PRD §4) rather than querying on every request — most of this data changes rarely (a hospital doesn't add departments daily) and lives on the hot path of many other services' operations (Order, Appointment, Billing all reference department/ward IDs).

## Error handling

- Referencing a `department_id`/`ward_id`/`icd10_id` that doesn't exist or is inactive from another service → that service's own validation responsibility (Master Data doesn't enforce referential integrity across service boundaries, per G2 — cross-service references are opaque IDs, not FKs). Master Data itself rejects creating a department with a duplicate `department_code` within a tenant, and rejects deactivating a department that's still referenced as `parent_department_id` by an active child.

## Testing

- Platform-level reference data (ICD10, states/districts) must be identical when read from any tenant context — a regression test asserting no tenant-specific override accidentally leaks into what's meant to be shared data.
- Cross-tenant isolation test for the per-tenant tables (`departments`, `wards`, `lookups`), same category as Identity & Access's and System Admin's cross-tenant tests.
