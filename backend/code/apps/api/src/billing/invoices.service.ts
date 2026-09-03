import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Payment } from './entities/payment.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { Deposit } from './entities/deposit.entity.js';
import { Return } from './entities/return.entity.js';
import { roundMoney } from './money.util.js';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { withAdvisoryLock } from '../database/advisory-lock.util.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CreateInvoiceItemInput {
  description: string;
  hsnSacCode?: string;
  quantity?: number;
  unitPrice: number;
  discountAmount?: number;
  taxPercent?: number;
  sourceOrderItemId?: string;
}

export interface CreateInvoiceInput {
  patientId: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  createdBy?: string;
  sourceAppointmentId?: string;
  sourceAdmissionId?: string;
  notes?: string;
  items: CreateInvoiceItemInput[];
}

export interface RecordPaymentInput {
  amount: number;
  paymentMode: string;
  sourceDepositId?: string;
  transactionReference?: string;
  bankName?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  receivedBy?: string;
}

export interface CreateReturnInput {
  amount: number;
  reason: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  returnedBy?: string;
}

export function getFinancialYearStart(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value); // 1-indexed here
  return month >= 4 ? year : year - 1;
}

export function formatFinancialYear(startYear: number): string {
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
    private readonly accountingService: AccountingService,
  ) {}

  /**
   * Actor fields (`createdBy`, `receivedBy`, `returnedBy`) are never trusted from the caller: the
   * authenticated principal (TenantContextService.accountId, set by TenantContextMiddleware from
   * the verified JWT) wins; the passed value is only a fallback for non-HTTP callers (service
   * specs) that run without a tenant context. These are billing sign-off fields, so spoofing them
   * would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  private static readonly PAYMENT_MODES = ['Cash', 'Card', 'UPI', 'Cheque', 'Deposit', 'Insurance'] as const;

  private async generateInvoiceNumber(manager: EntityManager): Promise<{ invoiceNumber: number; financialYear: string }> {
    const startYear = getFinancialYearStart(new Date());
    const result = await manager.query(
      `
      INSERT INTO billing_sequences (prefix, year, "lastSequence")
      VALUES ($1, $2, 1)
      ON CONFLICT (prefix, year)
      DO UPDATE SET "lastSequence" = billing_sequences."lastSequence" + 1
      RETURNING "lastSequence"
      `,
      ['INV', startYear],
    );
    return { invoiceNumber: result[0].lastSequence as number, financialYear: formatFinancialYear(startYear) };
  }

  async create(
    input: CreateInvoiceInput,
  ): Promise<Invoice & { items: InvoiceItem[]; payments: Payment[]; returns: Return[] }> {
    if (input.sourceAppointmentId && input.sourceAdmissionId) {
      throw new BadRequestException(
        'An invoice can have at most one source: sourceAppointmentId or sourceAdmissionId, not both',
      );
    }
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('An invoice must include at least one item');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.getRepository(Patient).findOne({ where: { id: input.patientId } });
      if (!patient) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      for (const item of input.items) {
        if (item.unitPrice < 0) {
          throw new BadRequestException(`Item "${item.description}" has a negative unitPrice`);
        }
        if (item.quantity !== undefined && item.quantity <= 0) {
          throw new BadRequestException(`Item "${item.description}" must have a positive quantity`);
        }
        const lineGross = item.unitPrice * (item.quantity ?? 1);
        if ((item.discountAmount ?? 0) > lineGross) {
          throw new BadRequestException(`Item "${item.description}" has a discountAmount exceeding its line subtotal`);
        }
      }

      const { invoiceNumber, financialYear } = await this.generateInvoiceNumber(manager);

      let subtotal = 0;
      let discountAmount = 0;
      let taxableAmount = 0;
      let taxAmount = 0;
      let totalAmount = 0;

      const itemsToInsert = input.items.map((item) => {
        const quantity = item.quantity ?? 1;
        const lineSubtotal = roundMoney(item.unitPrice * quantity);
        const lineDiscount = roundMoney(item.discountAmount ?? 0);
        const lineTaxable = roundMoney(lineSubtotal - lineDiscount);
        const taxPercent = item.taxPercent ?? 0;
        const lineTax = roundMoney(lineTaxable * (taxPercent / 100));
        const cgstAmount = roundMoney(lineTax / 2);
        const sgstAmount = roundMoney(lineTax - cgstAmount);
        const lineTotal = roundMoney(lineTaxable + lineTax);

        subtotal = roundMoney(subtotal + lineSubtotal);
        discountAmount = roundMoney(discountAmount + lineDiscount);
        taxableAmount = roundMoney(taxableAmount + lineTaxable);
        taxAmount = roundMoney(taxAmount + lineTax);
        totalAmount = roundMoney(totalAmount + lineTotal);

        return {
          sourceOrderItemId: item.sourceOrderItemId ?? null,
          description: item.description,
          hsnSacCode: item.hsnSacCode ?? null,
          quantity,
          unitPrice: item.unitPrice,
          discountAmount: lineDiscount,
          taxPercent,
          cgstAmount,
          sgstAmount,
          totalAmount: lineTotal,
        };
      });

      const invoiceRepository = manager.getRepository(Invoice);
      const invoice = await invoiceRepository.save(
        invoiceRepository.create({
          patientId: input.patientId,
          sourceAppointmentId: input.sourceAppointmentId ?? null,
          sourceAdmissionId: input.sourceAdmissionId ?? null,
          invoiceNumber,
          financialYear,
          subtotal,
          discountAmount,
          taxableAmount,
          taxAmount,
          totalAmount,
          paidAmount: 0,
          status: totalAmount === 0 ? 'Paid' : 'Unpaid',
          notes: input.notes ?? null,
          createdBy: this.resolveActor(input.createdBy),
        }),
      );

      const itemRepository = manager.getRepository(InvoiceItem);
      const items = await itemRepository.save(
        itemsToInsert.map((item) => itemRepository.create({ ...item, invoiceId: invoice.id })),
      );

      return { ...invoice, items, payments: [], returns: [] };
    });
  }

  /**
   * Manual re-run of charge capture for a single completed order item — the recovery path when
   * the automatic subscriber skipped or failed (e.g. the catalog price was set after the item was
   * completed). Runs captureChargeForOrderItem in its own transaction, so a re-run is safe to
   * repeat; idempotency (already-charged) still applies.
   */
  async reRunChargeCapture(orderItemId: string): Promise<{ captured: boolean; reason?: string }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const rows: { id: string; "orderId": string; itemType: string; itemDescription: string; status: string; "completedBy": string | null }[] =
        await manager.query(
          `SELECT id, "orderId", "itemType", "itemDescription", status, "completedBy"
           FROM order_items WHERE id = $1`,
          [orderItemId],
        );
      if (rows.length === 0) {
        throw new NotFoundException(`Order item ${orderItemId} not found`);
      }
      const item = rows[0];
      if (item.status !== 'Completed') {
        throw new ConflictException(
          `Order item ${orderItemId} is not Completed (status: ${item.status}); charge capture requires a completed item`,
        );
      }
      return this.captureChargeForOrderItem(manager, {
        id: item.id,
        orderId: item.orderId,
        itemType: item.itemType,
        itemDescription: item.itemDescription,
        completedBy: item.completedBy ?? undefined,
      });
    });
  }

  /**
   * Automatic charge capture: called by ChargeCaptureSubscriber when an OrderItem transitions to
   * 'Completed' (the single choke point every clinical completion flows through — Lab verify,
   * Radiology verify, Pharmacy dispense). Resolves the catalog price for the item's type, then
   * appends a line to the patient's open invoice, creating one if none exists. Runs on the
   * caller's EntityManager so the charge commits with the completing workflow's transaction.
   *
   * Best-effort by design: the caller (a TypeORM subscriber inside the business transaction) never
   * rethrows, so a pricing problem cannot roll back a lab verification. Unpriced items are skipped
   * (captured: false, reason 'unpriced') until the catalog price is set. Idempotent: an item that
   * already has an invoice line (sourceOrderItemId) is never charged twice. Revenue-journal posting
   * (Patient AR / Patient Service Revenue) shares this best-effort envelope: its own try/catch below
   * logs and swallows rather than rethrows, for the same "never roll back a clinical completion"
   * reason — unlike the fail-loud posting in recordPayment/createReturn.
   */
  async captureChargeForOrderItem(
    manager: EntityManager,
    orderItem: { id: string; orderId: string; itemType: string; itemDescription: string; completedBy?: string },
  ): Promise<{ captured: boolean; reason?: string }> {
    const orderRows = await manager.query(`SELECT "patientId" FROM orders WHERE id = $1`, [
      orderItem.orderId,
    ]);
    if (orderRows.length === 0) {
      return { captured: false, reason: 'order-not-found' };
    }
    const patientId = orderRows[0].patientId as string;

    // Serialize captures per patient: the find-open-invoice-then-append step below is not
    // otherwise race-safe — two order items of the same patient completing concurrently could
    // both see "no open invoice" and each create one. The advisory lock is transaction-scoped
    // (released on commit/rollback), so it only serializes concurrent captures of the same
    // patient, never holds across unrelated work, and needs no schema change.
    await withAdvisoryLock(manager, `charge_capture:${patientId}`);

    const alreadyCharged = await manager.query(
      `SELECT 1 FROM invoice_items WHERE "sourceOrderItemId" = $1 LIMIT 1`,
      [orderItem.id],
    );
    if (alreadyCharged.length > 0) {
      return { captured: false, reason: 'already-charged' };
    }

    let price: number | null = null;
    let description = orderItem.itemDescription;
    let quantity = 1;
    if (orderItem.itemType === 'Lab') {
      const rows = await manager.query(
        `SELECT t.price, t.name FROM lab_requisitions r JOIN lab_tests t ON t.id = r."testId"
         WHERE r."orderItemId" = $1 AND r.status != 'Cancelled' ORDER BY r."createdAt" DESC LIMIT 1`,
        [orderItem.id],
      );
      if (rows.length > 0) {
        price = rows[0].price === null ? null : Number(rows[0].price);
        description = rows[0].name;
      }
    } else if (orderItem.itemType === 'Radiology') {
      const rows = await manager.query(
        `SELECT i.price, i.name FROM radiology_requisitions rr JOIN radiology_imaging_items i ON i.id = rr."imagingItemId"
         WHERE rr."orderItemId" = $1 AND rr.status != 'Cancelled' ORDER BY rr."createdAt" DESC LIMIT 1`,
        [orderItem.id],
      );
      if (rows.length > 0) {
        price = rows[0].price === null ? null : Number(rows[0].price);
        description = rows[0].name;
      }
    } else if (orderItem.itemType === 'Pharmacy') {
      // Quantity flows into the charge (not just the price): dispensing a strip of 10 tablets
      // must bill for 10, not 1 — pd.quantity is the actual dispensed amount, unlike Lab/
      // Radiology where a requisition/study is always a single billable unit.
      const rows = await manager.query(
        `SELECT i."salePrice", i.name, pd.quantity FROM pharmacy_dispensings pd JOIN inventory_items i ON i.id = pd."inventoryItemId"
         WHERE pd."orderItemId" = $1 AND pd.status != 'Cancelled' ORDER BY pd."createdAt" DESC LIMIT 1`,
        [orderItem.id],
      );
      if (rows.length > 0) {
        price = rows[0].salePrice === null ? null : Number(rows[0].salePrice);
        description = rows[0].name;
        quantity = Number(rows[0].quantity);
      }
    } else {
      return { captured: false, reason: `unsupported itemType ${orderItem.itemType}` };
    }

    if (price === null) {
      return { captured: false, reason: 'unpriced' };
    }

    return this.postChargeCapture(manager, {
      patientId,
      sourceId: orderItem.id,
      description,
      priceRaw: price,
      quantity,
      completedBy: orderItem.completedBy,
    });
  }

  /**
   * OTC/walk-in pharmacy sale: dispensing with no doctor's order behind it (PharmacyDispensingService
   * .createWalkInSale), so there is no order_items row for ChargeCaptureSubscriber to key off — the
   * caller invokes this directly, in the same transaction as the stock decrement. Unlike
   * captureChargeForOrderItem (best-effort — a billing gap must never block a clinical completion),
   * an unpriced item here throws: a walk-in sale IS the billing event, so letting stock walk out
   * uncharged would be a straight revenue leak, not a deferred capture. Reuses
   * `sourceOrderItemId`/`UQ_invoice_items_source_order_item` as a generic "source record id"
   * idempotency guard (see the column's other callers) — for this path it holds the
   * PharmacyDispensing id rather than an order_items id, which the constraint doesn't distinguish.
   */
  async captureChargeForWalkInPharmacySale(
    manager: EntityManager,
    input: {
      patientId: string;
      dispensingId: string;
      inventoryItemId: string;
      quantity: number;
      completedBy?: string;
    },
  ): Promise<{ captured: boolean }> {
    await withAdvisoryLock(manager, `charge_capture:${input.patientId}`);

    const alreadyCharged = await manager.query(
      `SELECT 1 FROM invoice_items WHERE "sourceOrderItemId" = $1 LIMIT 1`,
      [input.dispensingId],
    );
    if (alreadyCharged.length > 0) {
      // Unreachable in practice — dispensingId is a freshly generated uuid every call — but a
      // walk-in sale must never leave stock uncharged, so this can't silently no-op like the
      // best-effort order-routed path does for the same condition.
      throw new ConflictException(`Dispensing ${input.dispensingId} already has a captured charge`);
    }

    const rows = await manager.query(`SELECT "salePrice", name FROM inventory_items WHERE id = $1`, [
      input.inventoryItemId,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException(`Inventory item ${input.inventoryItemId} not found`);
    }
    const price = rows[0].salePrice === null ? null : Number(rows[0].salePrice);
    if (price === null) {
      throw new ConflictException(
        `Inventory item ${input.inventoryItemId} has no sale price; cannot complete a walk-in sale`,
      );
    }

    return this.postChargeCapture(manager, {
      patientId: input.patientId,
      sourceId: input.dispensingId,
      description: rows[0].name as string,
      priceRaw: price,
      quantity: input.quantity,
      completedBy: input.completedBy,
      failLoud: true,
    });
  }

  /**
   * Voids the invoice line + reverses the AR/revenue journal a walk-in pharmacy sale posted
   * (PharmacyDispensingService.reverseDispensing, walk-in path only). Order-routed reversals stay
   * stock-only by design (a resulting invoice correction goes through the normal staff-initiated
   * createReturn, since a payment is the common case by the time anyone reverses one) — but a
   * walk-in sale is typically reversed within seconds of the sale, almost always before any
   * payment is recorded, and createReturn refuses to run against an invoice with no recorded
   * payments ("use cancel instead"), which would force cancelling the patient's entire open
   * invoice just to undo one line. Scoped narrowly: only ever called for a line this same service
   * created via captureChargeForWalkInPharmacySale, found by the same sourceOrderItemId key.
   */
  async voidWalkInPharmacySaleCharge(manager: EntityManager, dispensingId: string): Promise<void> {
    const invoiceItem = await manager.getRepository(InvoiceItem).findOne({
      where: { sourceOrderItemId: dispensingId },
    });
    if (!invoiceItem) {
      return; // Charge capture itself must have failed/never ran — nothing to void.
    }

    const invoiceRepository = manager.getRepository(Invoice);
    const invoice = await invoiceRepository.findOne({
      where: { id: invoiceItem.invoiceId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) {
      throw new Error(`Invariant violation: invoice ${invoiceItem.invoiceId} for invoice item ${invoiceItem.id} not found`);
    }
    if (invoice.paidAmount > 0) {
      throw new ConflictException(
        `Invoice ${invoice.id} already has a payment recorded against it; cannot auto-void the walk-in sale line — use a manual return instead`,
      );
    }

    await manager.getRepository(InvoiceItem).delete({ id: invoiceItem.id });

    invoice.subtotal = roundMoney(invoice.subtotal - invoiceItem.unitPrice * invoiceItem.quantity);
    invoice.taxableAmount = roundMoney(invoice.taxableAmount - invoiceItem.unitPrice * invoiceItem.quantity);
    invoice.taxAmount = roundMoney(invoice.taxAmount - (invoiceItem.cgstAmount + invoiceItem.sgstAmount));
    invoice.totalAmount = roundMoney(invoice.subtotal - invoice.discountAmount + invoice.taxAmount);
    await invoiceRepository.save(invoice);

    // Distinct sourceType/sourceId from the original charge-capture journal (which was keyed
    // 'InvoiceItem':invoiceItem.id): postAutoJournal is idempotent per (sourceType, sourceId) and
    // requires identical lines on a repeat — reusing that same key here, with the debit/credit
    // sides swapped, would trip its "conflicting duplicate" guard instead of posting the reversal.
    // Matches this file's existing precedent of a dedicated sourceType per reversal kind
    // ('InvoiceCancellation', 'Return').
    await this.accountingService.postAutoJournal(manager, {
      sourceType: 'WalkInSaleVoid',
      sourceId: dispensingId,
      entryDate: today(),
      narration: `Walk-in sale reversed: ${invoiceItem.description}`,
      lines: [
        { accountId: LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE, debit: invoiceItem.totalAmount },
        { accountId: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, credit: invoiceItem.totalAmount },
      ],
    });
  }

  /**
   * Shared tail of every charge-capture path: find-or-create the patient's open invoice, append a
   * line, roll the totals, and post the AR/revenue journal. Split out of captureChargeForOrderItem
   * so captureChargeForWalkInPharmacySale doesn't duplicate the money-handling logic — everything
   * before this (price lookup, unpriced/already-charged handling) differs per caller and stays
   * there.
   */
  private async postChargeCapture(
    manager: EntityManager,
    input: {
      patientId: string;
      sourceId: string;
      description: string;
      priceRaw: number;
      quantity?: number;
      completedBy?: string;
      /**
       * Order-routed captures are best-effort: a ledger-post failure is logged and swallowed
       * because the clinical action it's attached to (a Lab/Radiology/Pharmacy completion) must
       * never roll back over a billing problem. A walk-in sale has no clinical action to
       * protect — the sale IS the billing event — so its caller sets this to rethrow instead,
       * rolling the whole sale (stock decrement included) back rather than silently leaving an
       * invoice line with no matching journal entry.
       */
      failLoud?: boolean;
    },
  ): Promise<{ captured: boolean }> {
    // Row-locked like every other invoice mutator (recordPayment/createReturn/cancel): without
    // this, a concurrent recordPayment/createReturn/cancel committing between this read and the
    // save() below leaves this method's paidAmount/status computed from a stale, pre-commit
    // paidAmount (code-review-findings-2026-08-25 P2). The advisory lock above only serializes
    // concurrent charge-captures of the same patient (the open-invoice-creation race); it can't
    // protect an already-existing invoice's row against a concurrent payment/return/cancel.
    const invoiceRepository = manager.getRepository(Invoice);
    const openInvoice = await invoiceRepository.findOne({
      where: { patientId: input.patientId, status: In(['Unpaid', 'PartiallyPaid']) },
      order: { createdAt: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
    const invoice = openInvoice ?? (await this.createCaptureInvoice(manager, input.patientId, input.completedBy));

    const unitPrice = roundMoney(input.priceRaw);
    const quantity = input.quantity ?? 1;
    const lineSubtotal = roundMoney(unitPrice * quantity);

    // Charge capture no longer hardcodes 0% tax: the line carries the tenant's configured
    // default GST rate from billing_settings (0 = exempt, and the pre-settings behavior) —
    // code-review-findings-2026-08-25 P2. The tax is rolled into the AR/revenue journal below,
    // matching how every other money movement in this codebase treats tax (no GST-liability
    // account exists; see the journal comment).
    const settingsRows = await manager.query(
      `SELECT "defaultTaxPercent" FROM billing_settings WHERE id = 'default'`,
    );
    const taxPercent = settingsRows.length > 0 ? Number(settingsRows[0].defaultTaxPercent) : 0;
    const lineTax = roundMoney((lineSubtotal * taxPercent) / 100);
    const cgstAmount = roundMoney(lineTax / 2);
    const sgstAmount = roundMoney(lineTax - cgstAmount);
    const lineTotal = roundMoney(lineSubtotal + lineTax);

    const invoiceItem = await manager.getRepository(InvoiceItem).save(
      manager.getRepository(InvoiceItem).create({
        invoiceId: invoice.id,
        sourceOrderItemId: input.sourceId,
        description: input.description,
        quantity,
        unitPrice,
        discountAmount: 0,
        taxPercent,
        cgstAmount,
        sgstAmount,
        totalAmount: lineTotal,
      }),
    );

    invoice.subtotal = roundMoney(invoice.subtotal + lineSubtotal);
    // Captured lines carry taxPercent from billing_settings (possibly 0), so the line's taxable
    // amount is its subtotal — without this, taxableAmount silently stayed 0 forever on every
    // auto-generated invoice (code-review-findings-2026-08-25 P1).
    invoice.taxableAmount = roundMoney(invoice.taxableAmount + lineSubtotal);
    invoice.taxAmount = roundMoney(invoice.taxAmount + lineTax);
    invoice.totalAmount = roundMoney(invoice.subtotal - invoice.discountAmount + invoice.taxAmount);
    invoice.status =
      invoice.paidAmount >= invoice.totalAmount
        ? 'Paid'
        : invoice.paidAmount > 0
          ? 'PartiallyPaid'
          : 'Unpaid';
    await invoiceRepository.save(invoice);

    // Revenue recognized now, at charge-capture (not at payment) — see Development-Standards.md
    // "Automatic ledger posting from Billing". Best-effort for an order-routed capture (this runs
    // inside the same transaction as a Lab/Radiology/Pharmacy completion, and per the human ruling
    // documented on captureChargeForOrderItem's class-level doc comment, a ledger problem must
    // never roll back that clinical completion) — but fail-loud when `failLoud` is set (the
    // walk-in path: there is no clinical action to protect, and a swallowed Postgres error here
    // would otherwise abort the transaction while this method carries on writing to it, so
    // `commitTransaction()` would silently degrade to a no-op ROLLBACK and the caller would return
    // a 201 for a sale that never persisted). Known limitation of the best-effort branch: if this
    // throws, the invoice item still exists, so a later reRunChargeCapture retry short-circuits on
    // "already-charged" and never retries the revenue posting — recovery is manual, matching the
    // pre-existing "no re-run endpoint for a failed capture" caveat. The journal amount is the
    // line's full total (subtotal + tax): this codebase has no GST-liability ledger account, so
    // tax is rolled into revenue exactly as manual-invoice payments already do (a separate
    // GST-liability model is net-new accounting work, not this fix).
    try {
      await this.accountingService.postAutoJournal(manager, {
        sourceType: 'InvoiceItem',
        sourceId: invoiceItem.id,
        entryDate: today(),
        narration: `Charge capture: ${input.description}`,
        actor: input.completedBy,
        lines: [
          { accountId: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, debit: lineTotal },
          { accountId: LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE, credit: lineTotal },
        ],
      });
    } catch (error) {
      if (input.failLoud) {
        throw error;
      }
      this.logger.error(
        `Revenue posting failed for invoice item ${invoiceItem.id} (source ${input.sourceId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { captured: true };
  }

  private async createCaptureInvoice(
    manager: EntityManager,
    patientId: string,
    completedBy?: string,
  ): Promise<Invoice> {
    const { invoiceNumber, financialYear } = await this.generateInvoiceNumber(manager);
    // createdBy must never be null: it is a NOT NULL uuid column, and a failed INSERT inside the
    // completing workflow's transaction would roll the whole thing back. The authenticated
    // principal wins; the completing actor (order item completedBy) is the fallback for
    // non-HTTP callers that set one.
    const createdBy = this.tenantContext.getAccountId() ?? completedBy ?? ('' as string);
    return manager.getRepository(Invoice).save(
      manager.getRepository(Invoice).create({
        patientId,
        invoiceNumber,
        financialYear,
        subtotal: 0,
        discountAmount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        paidAmount: 0,
        status: 'Unpaid',
        createdBy,
      }),
    );
  }

  async findOne(id: string): Promise<Invoice & { items: InvoiceItem[]; payments: Payment[]; returns: Return[] }> {    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const invoice = await manager.getRepository(Invoice).findOne({ where: { id } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      const items = await manager.getRepository(InvoiceItem).find({
        where: { invoiceId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      const payments = await manager.getRepository(Payment).find({
        where: { invoiceId: id },
        order: { receivedAt: 'ASC', id: 'ASC' },
      });
      const returns = await manager.getRepository(Return).find({
        where: { invoiceId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      return { ...invoice, items, payments, returns };
    });
  }

  async list(query: PaginationQueryDto & { patientId?: string }): Promise<PaginatedResponseDto<Invoice>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(Invoice).createQueryBuilder('invoice');
      
      if (query.patientId) {
        qb.andWhere('invoice.patientId = :patientId', { patientId: query.patientId });
      }

      qb.orderBy('invoice.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async cancel(id: string): Promise<Invoice> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Invoice);
      const invoice = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      if (invoice.status === 'Cancelled') {
        throw new ConflictException(`Invoice ${id} is already cancelled`);
      }
      if (invoice.status === 'Paid') {
        throw new ConflictException(`Invoice ${id} is already paid and cannot be cancelled`);
      }
      if (invoice.paidAmount > 0) {
        throw new ConflictException(`Invoice ${id} cannot be cancelled because it has recorded payments`);
      }
      invoice.status = 'Cancelled';
      const cancelled = await repository.save(invoice);

      // Reverses exactly the revenue captureChargeForOrderItem posted for this invoice, no more:
      // paidAmount === 0 is already guaranteed above, so no return/payment has touched this
      // invoice, and every auto-captured line's totalAmount is exactly what was journaled for it
      // (unitPrice + the settings default tax, since the capture journal books the line total).
      // Manually-created lines (sourceOrderItemId null) never posted a journal in the first
      // place, so they're excluded — reversing them would fabricate a debit/credit pair with no
      // original entry. Without this, cancelling a charge-captured invoice left Patient AR and
      // Patient Service Revenue permanently overstated (code-review-findings-2026-08-25 P1).
      // Fails loud, like recordPayment/createReturn — a cancellation is an explicit user-initiated
      // financial action, not a best-effort clinical-completion side effect.
      const capturedRows = await manager.query(
        `SELECT COALESCE(SUM("totalAmount"), 0) AS total FROM invoice_items
         WHERE "invoiceId" = $1 AND "sourceOrderItemId" IS NOT NULL`,
        [id],
      );
      const capturedAmount = roundMoney(Number(capturedRows[0].total));
      if (capturedAmount > 0) {
        await this.accountingService.postAutoJournal(manager, {
          sourceType: 'InvoiceCancellation',
          sourceId: id,
          entryDate: today(),
          narration: `Reversal of charge-captured revenue for cancelled invoice ${id}`,
          lines: [
            { accountId: LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE, debit: capturedAmount },
            { accountId: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, credit: capturedAmount },
          ],
        });
      }

      return cancelled;
    });
  }

  async recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<Payment> {
    if (!InvoicesService.PAYMENT_MODES.includes(input.paymentMode as (typeof InvoicesService.PAYMENT_MODES)[number])) {
      throw new BadRequestException(`Unsupported paymentMode: ${input.paymentMode}`);
    }
    if (input.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    if (input.paymentMode === 'Deposit' && !input.sourceDepositId) {
      throw new BadRequestException('sourceDepositId is required when paymentMode is Deposit');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const invoiceRepository = manager.getRepository(Invoice);
      const invoice = await invoiceRepository.findOne({ where: { id: invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.status === 'Cancelled') {
        throw new ConflictException(`Invoice ${invoiceId} is cancelled and cannot accept payments`);
      }

      const outstanding = roundMoney(invoice.totalAmount - invoice.paidAmount);
      if (input.amount > outstanding) {
        throw new BadRequestException(`Payment amount ${input.amount} exceeds outstanding balance ${outstanding}`);
      }

      if (input.paymentMode === 'Deposit') {
        const depositRepository = manager.getRepository(Deposit);
        const deposit = await depositRepository.findOne({ where: { id: input.sourceDepositId }, lock: { mode: 'pessimistic_write' } });
        if (!deposit) {
          throw new NotFoundException(`Deposit ${input.sourceDepositId} not found`);
        }
        if (deposit.patientId !== invoice.patientId) {
          throw new BadRequestException(`Deposit ${input.sourceDepositId} does not belong to patient ${invoice.patientId}`);
        }
        if (input.amount > deposit.balance) {
          throw new ConflictException(`Deposit ${input.sourceDepositId} has insufficient balance for this payment`);
        }
        deposit.balance = roundMoney(deposit.balance - input.amount);
        await depositRepository.save(deposit);
      }

      const paymentRepository = manager.getRepository(Payment);
      const payment = await paymentRepository.save(
        paymentRepository.create({
          invoiceId,
          amount: input.amount,
          paymentMode: input.paymentMode,
          sourceDepositId: input.paymentMode === 'Deposit' ? (input.sourceDepositId as string) : null,
          transactionReference: input.transactionReference ?? null,
          bankName: input.bankName ?? null,
          receivedBy: this.resolveActor(input.receivedBy),
        }),
      );

      invoice.paidAmount = roundMoney(invoice.paidAmount + input.amount);
      invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'Paid' : 'PartiallyPaid';
      await invoiceRepository.save(invoice);

      // Cash/bank (or the deposit liability, for a Deposit-sourced payment) settles what the
      // patient owes (Patient AR) — revenue was already recognized at charge-capture. Runs in this
      // same transaction and fails loud: a ledger-mapping bug must never silently under-book money
      // (see Development-Standards.md "Automatic ledger posting from Billing").
      await this.accountingService.postAutoJournal(manager, {
        sourceType: 'Payment',
        sourceId: payment.id,
        entryDate: today(),
        narration: `Payment ${input.paymentMode} received for invoice ${invoiceId}`,
        actor: payment.receivedBy,
        lines: [
          {
            accountId:
              input.paymentMode === 'Deposit'
                ? LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE
                : LEDGER_ACCOUNT_IDS.CASH_AND_BANK,
            debit: input.amount,
          },
          { accountId: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, credit: input.amount },
        ],
      });

      return payment;
    });
  }

  async createReturn(invoiceId: string, input: CreateReturnInput): Promise<Return> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('Return amount must be a positive number');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const invoiceRepository = manager.getRepository(Invoice);
      const invoice = await invoiceRepository.findOne({ where: { id: invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.paidAmount <= 0) {
        throw new BadRequestException(
          `Invoice ${invoiceId} has no recorded payments to return against — use cancel instead`,
        );
      }
      if (input.amount > invoice.paidAmount) {
        throw new BadRequestException(`Return amount ${input.amount} exceeds invoice paidAmount ${invoice.paidAmount}`);
      }

      const returnRepository = manager.getRepository(Return);
      const returnRecord = await returnRepository.save(
        returnRepository.create({
          invoiceId,
          amount: input.amount,
          reason: input.reason,
          returnedBy: this.resolveActor(input.returnedBy),
        }),
      );

      // subtotal/taxableAmount/taxAmount must move with totalAmount here: captureChargeForOrderItem
      // recomputes totalAmount from subtotal/tax on the next completion, so if a return only
      // touched totalAmount, that recompute would silently re-inflate it back up by the amount
      // just returned (code-review-findings-2026-08-25 P1). The GST split is reversed
      // proportionally — a return is amount-based (no line allocation), so the returned amount's
      // tax portion is the invoice's tax-to-total ratio; taxable and tax shrink in lockstep so
      // total = taxable + tax stays exact (code-review-findings-2026-08-25 P2). Per-line
      // cgst/sgst on invoice_items can't be reversed without a line-based return model — the
      // invoice-level split is what keeps tax reporting honest.
      const totalBefore = invoice.totalAmount;
      const taxShare =
        totalBefore > 0 ? roundMoney((invoice.taxAmount * input.amount) / totalBefore) : 0;
      const taxableShare = roundMoney(input.amount - taxShare);
      invoice.subtotal = roundMoney(invoice.subtotal - taxableShare);
      invoice.taxableAmount = roundMoney(invoice.taxableAmount - taxableShare);
      invoice.taxAmount = roundMoney(invoice.taxAmount - taxShare);
      invoice.totalAmount = roundMoney(invoice.totalAmount - input.amount);
      invoice.paidAmount = roundMoney(invoice.paidAmount - input.amount);
      invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'Paid' : 'PartiallyPaid';
      await invoiceRepository.save(invoice);

      // Contra-revenue entry: reverses the amount originally recognized at charge-capture against
      // Patient AR. Fails loud, same as recordPayment above.
      await this.accountingService.postAutoJournal(manager, {
        sourceType: 'Return',
        sourceId: returnRecord.id,
        entryDate: today(),
        narration: `Return/credit note for invoice ${invoiceId}: ${input.reason}`,
        actor: returnRecord.returnedBy,
        lines: [
          { accountId: LEDGER_ACCOUNT_IDS.SALES_RETURNS, debit: input.amount },
          { accountId: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, credit: input.amount },
        ],
      });

      return returnRecord;
    });
  }
}
