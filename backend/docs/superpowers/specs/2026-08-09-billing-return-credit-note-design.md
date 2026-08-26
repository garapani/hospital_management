# Billing: Return/Credit-Note Concept — Design Spec

**Track:** MVP fast track (see `CLAUDE.md`'s "The MVP Fast Track"). Written via
`mattpocock-skills:to-spec`'s template, synthesized from the existing `billing/` module and the
original `2026-08-01-billing-design.md` spec — no separate brainstorming interview.

## Problem Statement

Billing staff can create invoices, record payments against them, and cancel an invoice outright —
but only before any payment has landed (`InvoicesService.cancel` rejects any invoice with
`paidAmount > 0`). There is no way to record that a patient returned a billed item or had a
billed service reversed *after* paying for it (e.g. a dispensed medicine gets returned to
Pharmacy, a booked test is cancelled after the consultation fee was already paid). Right now the
only options are: leave the invoice as-is (patient is out the money on paper) or manually
mutate the database. The original Billing spec explicitly flagged "invoice returns/credit notes"
as deferred future work, not an oversight — this closes that gap for the MVP registration → visit
→ bill workflow.

## Solution

Add a `Return` concept scoped to a single invoice: billing staff can issue a return for a
positive amount up to the invoice's current `paidAmount`, with a reason. Issuing a return reduces
both the invoice's `totalAmount` and `paidAmount` by that amount and recomputes `status` using the
same rule `create()` and `recordPayment()` already use. This models "the patient owed less than
we billed them, and we're crediting/refunding the difference" as one atomic action — it does not
separately track a cash-refund step, a GST credit-note document, or per-line-item allocation.

## User Stories

1. As billing staff, I want to issue a return against a paid invoice, so that the invoice's
   record reflects the reduced amount actually owed after a billed item was reversed.
2. As billing staff, I want to issue a partial return against a partially-paid invoice, so that a
   single returned item among several billed items is reflected without touching the rest.
3. As billing staff, I want the system to reject a return larger than what was actually paid, so
   that I can't accidentally create a negative-payment state.
4. As billing staff, I want the system to reject a return on an invoice with no payments recorded
   yet, so that I'm pointed at the existing `cancel` endpoint instead (the right tool for that
   case).
5. As billing staff, I want a fully-returned invoice to end up in the same terminal state as a
   zero-value invoice created outright (`status: 'Paid'`, `totalAmount: 0`, `paidAmount: 0`), so
   that the invoice list doesn't show a returned invoice as still outstanding.
6. As billing staff, I want to see all returns issued against an invoice when I fetch it, the same
   way I already see its items and payments, so that I have one place to review its full history.

## Implementation Decisions

- New `Return` entity in `billing/entities/return.entity.ts`, table `returns`: `id` (uuid pk),
  `invoiceId` (uuid), `amount` (numeric 12,2, `numericTransformer`), `reason` (text),
  `returnedBy` (uuid — client-supplied, matching every other actor field in this codebase per the
  known cross-cutting gap logged in `pending-tasks.md`'s "Dependencies worth calling out
  explicitly"; not fixed here, out of scope), `createdAt` (timestamptz). No `updatedAt` — a return
  is immutable once issued, there is no revise/undo action.
- New `InvoicesService.createReturn(invoiceId, input: { amount: number; reason: string;
  returnedBy: string })`, structured like `recordPayment`: loads the invoice inside
  `runInTenantSchema`, validates, mutates `totalAmount`/`paidAmount`, saves both the new `Return`
  row and the updated `Invoice` row, returns the `Return`.
- Validation, in order: `amount > 0` (else `BadRequestException`); invoice exists (else
  `NotFoundException`); invoice `paidAmount > 0` (else `BadRequestException` naming `cancel` as
  the correct action for a zero-payment invoice — an invoice with `paidAmount === 0` is always
  either `Unpaid` or already `Cancelled`, never eligible for a return); `amount <=
  invoice.paidAmount` (else `BadRequestException`, mirroring `DepositsService.refund`'s balance
  check).
- Mutation: `invoice.totalAmount = roundMoney(invoice.totalAmount - amount)`,
  `invoice.paidAmount = roundMoney(invoice.paidAmount - amount)`, then recompute `status` with the
  exact same rule `recordPayment` uses (`paidAmount >= totalAmount ? 'Paid' : 'PartiallyPaid'`).
  Because `amount <= paidAmount <= totalAmount` always holds going in, `totalAmount` can never go
  negative and this rule can never produce anything other than `Paid` or `PartiallyPaid` — a full
  return of a fully-paid invoice lands at `totalAmount: 0, paidAmount: 0`, status `Paid`,
  consistent with `create()`'s existing "a zero-value invoice is immediately Paid" convention
  (`invoices.service.ts`'s `create()`, `status: totalAmount === 0 ? 'Paid' : 'Unpaid'`).
- `InvoicesService.findOne` gains a third array alongside `items`/`payments`: fetch
  `manager.getRepository(Return).find({ where: { invoiceId: id }, order: { createdAt: 'ASC' } })`
  and include it in the returned shape as `returns`.
- New endpoint `POST /billing/invoices/:id/returns` on `InvoicesController`, gated by the same
  `@RequirePermission('billing.manage')` every other invoice endpoint in this controller uses —
  no new permission string.
- New DTO `billing/dto/create-return.dto.ts`: `CreateReturnDto { amount!: number; reason!:
  string; returnedBy!: string }` — plain class, no `class-validator` decorators, matching every
  other DTO in this codebase (confirmed zero `class-validator` usage anywhere during the
  pagination-plan work).
- Register `Return` in `billing.module.ts`'s TypeORM entity list (wherever `Invoice`/`Payment`/
  `Deposit` are currently registered) and add the migration for the `returns` table following
  this codebase's existing migration pattern (check a recent billing migration, e.g. the one that
  created `invoice_items`/`payments`, for the exact shape/conventions to copy).

## Testing Decisions

- Only test external behavior (`InvoicesService`'s public methods and the HTTP endpoint), not
  internal mutation order — matching this codebase's existing integration-spec style.
- Per `CLAUDE.md`'s MVP fast-track step 3 (risk-scaled test rigor): Billing is a money-touching
  module, so this gets full `TenantTestContext`-based integration-spec treatment, same depth as
  `invoices.service.integration-spec.ts` and `invoices.controller.integration-spec.ts`.
- Service-level cases (`invoices.service.integration-spec.ts`, extending the existing `describe`
  block or a new one in the same file): full return of a fully-paid invoice zeroes
  `totalAmount`/`paidAmount` and sets `status: 'Paid'`; partial return of a partially-paid invoice
  reduces both fields and keeps `status: 'PartiallyPaid'`; rejects `amount <= 0`; rejects return
  exceeding `paidAmount`; rejects a return on an invoice with `paidAmount === 0` (both `Unpaid` and
  freshly-`Cancelled` cases); `findOne` includes the new `returns` array ordered by `createdAt`.
- Controller-level cases (`invoices.controller.integration-spec.ts`, prior art: this file's
  existing `POST /billing/invoices/:id/payments` tests): `POST .../:id/returns` happy path;
  permission-denial test for a caller lacking `billing.manage`, matching this file's existing
  permission-gating test shape for the other endpoints.
- Prior art for the money-mutation assertions: `invoices.service.integration-spec.ts`'s existing
  `recordPayment` tests (status transitions, `roundMoney` boundary behavior).

## Out of Scope

- Per-line-item returns (tying a return to a specific `InvoiceItem` rather than the invoice as a
  whole) — the invoice-level model above matches this module's existing flat-invoice granularity
  (there's no partial-cancel on `InvoiceItem` either).
- A distinct cash-refund step or payment-mode tracking for how the returned amount is given back
  to the patient (cash/bank transfer/adjusted against a new invoice) — modeled purely as an
  invoice-balance adjustment, same simplification level as the original Billing spec's payment
  model.
- Credit-note PDF/document generation and its GST treatment (a credit note has its own GST
  reporting implications in India) — GST scope stays exactly what the original Billing spec
  shipped (CGST/SGST on invoice creation only); revisit alongside the India Compliance Adapter.
- Multi-step approval workflow for issuing a return — single-actor action, same as every other
  write in this module.
- Credit-organization Settlement (Phase 3, Insurance & Claims) — unrelated concept, already
  correctly out of scope per the original spec; not touched by this work.

## Further Notes

- This item originated from the `mvp-status.md` audit, which initially bundled it with
  "Settlement" as a single MVP gap — that was corrected in `pending-tasks.md` before this spec was
  written: Settlement is a distinct, legitimately-deferred concept blocked on Phase 3 Insurance &
  Claims, not part of this item.
- `billing/money.util.ts`'s `roundMoney` must be used for every arithmetic step here, matching
  every other money mutation in this module (avoids float-precision drift, per this module's
  existing convention).
