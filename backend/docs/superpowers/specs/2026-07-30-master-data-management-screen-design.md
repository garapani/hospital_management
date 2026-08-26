# Master Data Management Screen — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§5.1); parent spec: `2026-07-30-master-data-service-design.md`
**App:** `staff-console` (Angular v18+)

## Scope

Hospital Admin's screen for managing their own hospital's Departments, Wards, and Lookups. Fourth of the five Phase 0 frontend screens.

**Explicitly not in scope:** the platform-level reference data (states/districts, ICD10 codes, payment modes) from the Master Data Service design. That data is centrally maintained and identical for every tenant — this screen only covers the three per-tenant, hospital-managed tables. Hospital Admins consume platform-level data (e.g. as dropdown options elsewhere) but don't edit it here.

**Access control:** Hospital Admin (own tenant) or Super Admin (any tenant, via existing cross-tenant context switch).

## Layout

Three sections within one screen: Departments, Wards, Lookups.

## Departments

List + create/edit form: department_code, department_name, description, is_appointment_applicable, parent_department (dropdown), room_number, notice_text.

Two data-integrity concerns the UI must actively enforce, not just pass through to the backend:

- **Circular-reference prevention:** the parent-department dropdown excludes the department being edited and all of its existing descendants. Without this, nothing stops constructing a cycle (A parent of B, B parent of A) through the hierarchy.
- **Deactivation guard:** Master Data Service's own design already rejects deactivating a department still referenced as `parent_department_id` by an active child. This screen surfaces that specific rejection with the actual blocking count ("Can't deactivate: 3 active departments report to this one"), not a generic save-failed message.

## Wards

List + create/edit form: ward_code, ward_name, ward_type, bed_capacity, is_active.

`ward_type` is populated from the generic `lookups` mechanism already designed into Master Data Service (a `lookups` row with `module_name = 'ward_type'`), rather than a hardcoded enum — the first concrete use of that pattern outside its own design doc.

## Lookups

**Structured row editor, not a raw JSON textarea — a deliberate UX/data-integrity decision.** The person using this screen is a Hospital Admin, not a developer. `lookup_data` is stored as `jsonb` with no fixed schema at the database layer, but for the common case (a list of selectable options — blood groups, reaction types, ward types, etc.) the UI presents a repeatable code+label row editor that serializes to a consistent array-of-objects shape. A malformed or inconsistent shape here would silently break whatever downstream service reads that lookup (e.g. Clinical/EMR expecting a specific structure from a `reaction_type` lookup) — free-text JSON editing would make that failure mode easy to hit by accident and hard to diagnose after the fact.

## Testing

- E2E: attempting to select a department's own descendant as its parent is blocked in the UI before submit.
- E2E: attempting to deactivate a department with active children is blocked, with the correct child count shown.
- E2E: ward CRUD basic flow, `ward_type` populated from the `lookups` mechanism.
- E2E: the structured lookup editor produces the expected array-of-objects shape; adding/removing rows behaves correctly.
