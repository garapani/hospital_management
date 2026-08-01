# Billing — Design Specification

## Overview

This module introduces Billing — the third Phase 1 module per the PRD's course-corrected priority order (Admission → Order → Billing), completing the "registration → visit → bill" loop (§8). It covers charge capture, invoicing, deposits, and payment collection for direct/self-pay patients.

The old system's Billing is a cautionary example, not a porting target: an 8,513-line `BillingController.cs`, a `BillingTransactionModel` with roughly 50 accreted fields spanning insurance, foreign exchange, co-payment, package billing, and Nepal-specific sync flags — exactly the "39 flat model folders, no bounded context" problem this re-platform exists to fix (§1). This design mines the old system only for real business concepts (charge lines, deposits, invoice numbering by fiscal year), not its structure.

**Scope for Phase 1:** charge capture, invoicing, deposits, and payment collection, with core GST-compliant invoice fields built in now — GST is a Phase-1 legal requirement for issuing invoices in India (§8), even though it is architecturally a separate India Compliance Adapter module (§5.7) for everything beyond core invoice fields (e-invoicing/IRN, ABHA, PM-JAY). Credit-organization settlement (the old system's "Settlement" concept — a corporate/insurance payer periodically reconciling a batch of credit-billed invoices) is explicitly deferred to Phase 3's Insurance & Claims module, since it depends on machinery that doesn't exist yet.

## Architecture & Data Flow

New `BillingModule` (`apps/api/src/billing/`), following the same modular-monolith pattern as `OrdersModule`/`AdmissionsModule`: Controller → Service → TypeORM, all operations scoped via `TenantConnectionService`.

Five pieces:

- **`BillingSettings`** — one row per tenant holding the hospital's GSTIN and state code. A hospital bills for services rendered in person at its own location, so GST's "place of supply" rule makes every invoice intra-state — tax always splits as CGST+SGST, never IGST. This removes the need for per-invoice interstate/intrastate branching.
- **`Invoice`** — header record: patient, optional clinical-context source (`sourceAppointmentId`/`sourceAdmissionId`, mirroring the pattern already established by `Admission` and `Order`), computed totals, status.
- **`InvoiceItem`** — child charge line: free-text description (no service/pricing catalog exists yet, consistent with `Order`'s `OrderItem`), HSN/SAC code, price, tax. Optionally references the `OrderItem` it originated from via `sourceOrderItemId`, for traceability only — no computed price lookup, since `OrderItem` carries no price.
- **`Payment`** — money received against an invoice. Supports partial payments (invoice creation and payment collection are two separate steps, not a single POS-style transaction). One `paymentMode` is `Deposit`, which draws down a patient's deposit balance instead of representing new incoming cash.
- **`Deposit`** — advance payment tracking with a running balance, applied via `Payment` or refunded directly.

Invoice numbering reuses the existing `PatientSequence` pattern (composite key + running counter), since GST requires sequential, gap-free invoice numbers per financial year (April–March).

## Data Model

### `BillingSettings` (table: `billing_settings`, singleton per tenant)

- `id`: fixed value (`'default'`) — enforces a single row per tenant schema
- `gstin`: varchar, required
- `stateCode`: varchar(2) — GST state code, must match GSTIN's first 2 digits
- `hospitalLegalName`: varchar (appears on invoices as the supplier name)
- `createdAt`, `updatedAt`

### `BillingSequence` (table: `billing_sequences`, mirrors `PatientSequence`)

- `prefix`: varchar(20) (Primary Key, part 1)
- `year`: integer (Primary Key, part 2 — financial year start, e.g. `2026` for FY 2026-27)
- `lastSequence`: integer, default 0

### `Invoice` (table: `invoices`)

- `id`: UUID (Primary Key)
- `patientId`: UUID, required
- `sourceAppointmentId`: UUID, nullable
- `sourceAdmissionId`: UUID, nullable
- `invoiceNumber`: integer (sequential within `financialYear`, generated from `BillingSequence`)
- `financialYear`: varchar (e.g. `"2026-27"`)
- `subtotal`: numeric
- `discountAmount`: numeric
- `taxableAmount`: numeric
- `taxAmount`: numeric
- `totalAmount`: numeric
- `paidAmount`: numeric, default 0 — denormalized sum of this invoice's `Payment` rows, recomputed on each payment (never trusts a client-supplied value)
- `status`: varchar, default `'Unpaid'` (`Unpaid` | `PartiallyPaid` | `Paid` | `Cancelled`)
- `notes`: text, nullable
- `createdBy`: UUID, required
- `createdAt`, `updatedAt`

### `InvoiceItem` (table: `invoice_items`)

- `id`: UUID (Primary Key)
- `invoiceId`: UUID, required (indexed)
- `sourceOrderItemId`: UUID, nullable
- `description`: text (free text — no service catalog yet)
- `hsnSacCode`: varchar, nullable (required for taxable items; GST-exempt clinical services may omit it)
- `quantity`: numeric, default 1
- `unitPrice`: numeric
- `discountAmount`: numeric, default 0
- `taxPercent`: numeric, default 0 (0 = GST-exempt, the common case for core clinical services)
- `cgstAmount`: numeric — half of `taxPercent × taxableAmount`
- `sgstAmount`: numeric — the other half
- `totalAmount`: numeric
- `createdAt`

### `Payment` (table: `payments`)

- `id`: UUID (Primary Key)
- `invoiceId`: UUID, required (indexed)
- `amount`: numeric
- `paymentMode`: varchar (`Cash` | `Card` | `UPI` | `Cheque` | `Deposit`)
- `sourceDepositId`: UUID, nullable — required when `paymentMode = 'Deposit'`
- `receivedBy`: UUID, required
- `receivedAt`: timestamptz, default now
- `createdAt`

### `Deposit` (table: `deposits`)

- `id`: UUID (Primary Key)
- `patientId`: UUID, required
- `amount`: numeric (original amount received)
- `balance`: numeric (mutated by `Payment` application and by refund)
- `receivedBy`: UUID, required
- `receivedAt`: timestamptz, default now
- `notes`: text, nullable
- `createdAt`, `updatedAt`

## RBAC & Security

**Permissions:**
- `billing.manage`: create invoices, record payments, cancel invoices, manage deposits
- `master-data.manage` (existing): view/update `BillingSettings` — hospital-wide compliance configuration (GSTIN, legal name), not day-to-day billing work, so it stays out of `billing.manage`'s reach (same reasoning as Bed CRUD living under Master Data's permission).

**Role Mappings** (per PRD §6.1, where only these two roles have any Billing access — unlike Order/Admission, no role gets read-only Billing access):
- **Receptionist / Front Desk**: `billing.manage`
- **Billing/Accounts Staff**: `billing.manage`
- **Hospital Admin**: `billing.manage`, `master-data.manage` (already held)
- **Super Admin**: `billing.manage`, `master-data.manage` (already held)

## API Endpoints

- `POST /billing/invoices` — create an invoice with one or more items. Body: `patientId`, at most one of `sourceAppointmentId`/`sourceAdmissionId`, optional `notes`, `items: [{ description, hsnSacCode?, quantity?, unitPrice, discountAmount?, taxPercent? }]`. Requires `billing.manage`.
- `GET /billing/invoices` — list invoices, optional `?patientId=` filter, paginated (`page`/`limit`, `limit` capped at 100). Requires `billing.manage`.
- `GET /billing/invoices/:id` — invoice detail including its items and payments. Requires `billing.manage`.
- `PATCH /billing/invoices/:id/cancel` — cancel an invoice. Requires `billing.manage`.
- `POST /billing/invoices/:id/payments` — record a payment. Body: `amount`, `paymentMode`, `sourceDepositId?`. Requires `billing.manage`.
- `POST /billing/deposits` — record a new deposit. Body: `patientId`, `amount`, `notes?`. Requires `billing.manage`.
- `GET /billing/deposits` — list deposits, optional `?patientId=` filter, paginated. Requires `billing.manage`.
- `PATCH /billing/deposits/:id/refund` — refund some or all of a deposit's unused balance. Body: `amount`. Requires `billing.manage`.
- `GET /billing/settings` — view GSTIN/state code/legal name. Requires `master-data.manage`.
- `PATCH /billing/settings` — update GSTIN/state code/legal name. Requires `master-data.manage`.

## Error Handling

- Creating an invoice with an empty `items` array throws `BadRequestException`.
- Unknown `patientId` on invoice or deposit creation throws `NotFoundException`.
- A payment `amount` ≤ 0, or exceeding the invoice's outstanding balance (`totalAmount - paidAmount`), throws `BadRequestException` — no overpayment/change handling in this API.
- `paymentMode: 'Deposit'` with a missing/unknown `sourceDepositId` throws `NotFoundException`; belonging to a different patient throws `BadRequestException`; insufficient balance throws `ConflictException`.
- Cancelling an invoice that already has a payment, or is already `Cancelled`, throws `ConflictException`.
- Refunding a deposit for an amount ≤ 0, or exceeding its current balance, throws `BadRequestException`.
- Unknown `invoice`/`deposit` IDs throw `NotFoundException`.

## Testing

Integration tests against real Postgres, tenant-scoped, following the established pattern (`orders.service.integration-spec.ts`, `admissions.service.integration-spec.ts`):

- `BillingService`: create an invoice with mixed taxable/exempt items (correct CGST/SGST split and totals); reject an empty `items` array; reject unknown `patientId`; sequential `invoiceNumber` generation per financial year; record a partial payment (status → `PartiallyPaid`); record a payment completing the balance (status → `Paid`); reject a payment exceeding the outstanding balance; reject cancelling an invoice that has a payment; cancel an `Unpaid` invoice; create a deposit; apply a deposit as a payment (deposit balance decrements, invoice paid); reject applying a deposit with insufficient balance; reject applying a deposit belonging to another patient; refund a deposit (partial and full); reject over-refunding; tenant isolation.
- `BillingSettings`: get/update GSTIN and state code; enforce singleton row.
- Controller: permission-gating smoke tests (401/403 without `billing.manage`/`master-data.manage`), matching the `OrdersController` pattern.

## Self-Review Notes

- **Placeholder scan:** No missing/TBD details.
- **Internal consistency:** `Invoice.paidAmount` and `status` are always derived from the sum of its `Payment` rows, recomputed server-side on each payment — never trusted from client input, avoiding drift between the two.
- **Scope check:** Deliberately excludes credit-organization settlement (Phase 3, Insurance & Claims), e-invoicing/IRN/QR generation, ABHA/PM-JAY (India Compliance Adapter's remaining scope), any service/pricing catalog (no such catalog exists yet anywhere in the system), and invoice returns/credit notes — all flagged as future work, not silently dropped.
- **Ambiguity check:** "Every invoice is intra-state (CGST+SGST only, never IGST)" is stated as a deliberate simplification based on GST's place-of-supply rule for in-person healthcare services, not an oversight. "A payment cannot exceed the outstanding balance" is a hard constraint — no change/overpayment handling in this API.
