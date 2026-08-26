# Order — Design Specification

## Overview

This module introduces a central Order module — the second Phase 1 module in the PRD's course-corrected priority order (Admission → Order → Billing). It gives clinicians a single place to place orders that will eventually route to Lab, Radiology, and Pharmacy, none of which exist yet (Phase 2).

The old system has no equivalent central entity: its "Orders" screen is a read-only aggregation view over `LabRequisitions`, `ImagingItemRequisitions`, and `MedicationPrescriptions`, each owned entirely by its own downstream module. The PRD deliberately diverges from that — "central order placement, routes to Lab/Radiology/Pharmacy" — so this module is new architecture, not a port.

Because Lab/Radiology/Pharmacy don't exist yet, this is deliberately a thin shell: a generic `Order`/`OrderItem` pair that captures what was ordered, for whom, and its status, with no catalog dependency (item descriptions are free text) and a minimal lifecycle (`Pending` → `Completed`/`Cancelled` — no `Acknowledged`/`InProgress`, since nothing exists yet to acknowledge or work an order). When Lab/Radiology/Pharmacy are built in Phase 2, they'll reference `OrderItem` by id rather than this module growing fulfillment logic itself.

## Architecture & Data Flow

New `OrdersModule` (`apps/api/src/orders/`), following the same modular-monolith pattern as `AdmissionsModule`/`VitalsModule`/`TriageModule`: Controller → Service → TypeORM, all operations scoped via `TenantConnectionService`.

`Order` is a header record (who placed it, for which patient, in what clinical context); `OrderItem` is a child entity — one order groups multiple items, and each item carries its own `itemType` and `status` independently, since a single order action can mix types (e.g. "CBC" [Lab] + "Chest X-ray" [Radiology] in one order) and each type will eventually route to and complete via a different downstream module.

An order's clinical context comes from at most one of `sourceAppointmentId` (OPD) or `sourceAdmissionId` (IPD) — both optional, mirroring the source-linkage pattern already established by `Admission` (`sourceAppointmentId`/`sourceTriageEntryId`). A standalone order (neither set) is also valid.

## Data Model

### `Order` (table: `orders`)

- `id`: UUID (Primary Key)
- `patientId`: UUID (Foreign Key → `patients`, required)
- `sourceAppointmentId`: UUID, nullable (Foreign Key → `appointments`)
- `sourceAdmissionId`: UUID, nullable (Foreign Key → `admissions`)
- `orderedBy`: UUID (ordering clinician, required)
- `orderedAt`: timestamptz, defaults to now
- `notes`: text, nullable (general order-level notes)
- `createdAt`, `updatedAt`

### `OrderItem` (table: `order_items`)

- `id`: UUID (Primary Key)
- `orderId`: UUID (Foreign Key → `orders`, required)
- `itemType`: varchar (`Lab` | `Radiology` | `Pharmacy` | `Other`)
- `itemDescription`: text (free text — no Lab/Radiology/Pharmacy catalog exists yet to reference)
- `priority`: varchar, default `Routine` (`Routine` | `Urgent` | `STAT`)
- `status`: varchar, default `Pending` (`Pending` | `Completed` | `Cancelled`)
- `completedBy`: UUID, nullable
- `completedAt`: timestamptz, nullable
- `cancelReason`: text, nullable
- `createdAt`, `updatedAt`

## RBAC & Security

**Permissions:**
- `order.manage`: place orders, complete/cancel items
- `order.read`: view orders

**Role Mappings:**
- **Doctor**: `order.manage`, `order.read`
- **Nurse**: `order.manage`, `order.read`
- **Hospital Admin**: `order.manage`, `order.read`
- **Super Admin**: `order.manage`, `order.read`
- **Receptionist / Front Desk**: `order.read` (view-only)

When Lab/Radiology/Pharmacy are built (Phase 2), their staff will need `order.manage` scoped to their own item type — not needed yet, since no such roles exist.

## API Endpoints

- `POST /orders` — place an order with one or more items. Body: `patientId`, `orderedBy`, at most one of `sourceAppointmentId`/`sourceAdmissionId`, optional `notes`, and `items: [{ itemType, itemDescription, priority? }]` (at least one item required). Requires `order.manage`.
- `GET /orders` — list orders, optional `?patientId=` filter. Requires `order.read`.
- `GET /orders/:id` — order detail including its items. Requires `order.read`.
- `PATCH /orders/:id/items/:itemId/complete` — mark an item completed. Body: `completedBy`. Requires `order.manage`.
- `PATCH /orders/:id/items/:itemId/cancel` — cancel an item. Body: optional `cancelReason`. Requires `order.manage`.

## Error Handling

- Providing both `sourceAppointmentId` and `sourceAdmissionId` on create throws `BadRequestException` (at most one source).
- Creating an order with an empty `items` array throws `BadRequestException`.
- Unknown `order`/`orderItem`/`patient` IDs throw `NotFoundException`.
- Completing or cancelling an item that is already `Completed` or `Cancelled` throws `ConflictException`.

## Testing

Integration tests against real Postgres, tenant-scoped, following the established pattern (see `admissions.service.integration-spec.ts`, `triage.service.integration-spec.ts`):

- `OrdersService`: create an order with mixed-type items; reject dual-source (`sourceAppointmentId` + `sourceAdmissionId`); reject an empty `items` array; complete an item independently of its siblings (siblings stay `Pending`); cancel an item with a reason; reject completing/cancelling an already-resolved item; list orders filtered by `patientId`; tenant isolation.
- Controller: permission-gating smoke tests (401/403 without `order.manage`/`order.read`), matching the `AdmissionsController`/`VitalsController`/`TriageController` pattern.

## Self-Review Notes

- **Placeholder scan:** No missing/TBD details.
- **Internal consistency:** `OrderItem.status` is the meaningful unit of progress (each item resolves independently); `Order` itself carries no aggregate status — a consumer wanting "is this whole order done" derives it from its items' statuses rather than the module maintaining a redundant, sync-prone field.
- **Scope check:** Deliberately excludes any Lab/Radiology/Pharmacy fulfillment logic, item catalogs, or result capture — those arrive with their respective Phase 2 modules, which will reference `OrderItem` by id rather than this module growing to anticipate them.
- **Ambiguity check:** "At most one source" is stated as a hard constraint, matching `Admission`'s equivalent rule. "One or more items required" is explicit — an order with zero items is not a valid state.
