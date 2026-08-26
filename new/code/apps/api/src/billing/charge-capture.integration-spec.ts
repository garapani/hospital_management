import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app/app.module.js';
import { TenantContextService } from '@hospital/tenant-context';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { LabCatalogService } from '../lab/lab-catalog.service.js';
import { LabWorkflowService } from '../lab/lab-workflow.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { PharmacyDispensingService } from '../pharmacy/pharmacy-dispensing.service.js';
import { StockBatch } from '../inventory/entities/stock-batch.entity.js';
import { StockBalance } from '../inventory/entities/stock-balance.entity.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalEntry, JournalLine } from '../accounting/entities/journal-entry.entity.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('Charge capture (integration) — order-item completion auto-charges the patient', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;

  let patientsService: PatientsService;
  let ordersService: OrdersService;
  let labCatalogService: LabCatalogService;
  let labWorkflowService: LabWorkflowService;
  let inventoryCatalogService: InventoryCatalogService;
  let pharmacyDispensingService: PharmacyDispensingService;
  let invoicesService: InvoicesService;
  let accountingService: AccountingService;

  const DOCTOR_ID = '00000000-0000-0000-0000-000000000001';
  const STAFF_ID = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ctx = await setupTenantTestContext({ namePrefix: 'charge_capture' });

    tenantConnection = moduleFixture.get(TenantConnectionService);
    tenantContextService = moduleFixture.get(TenantContextService);
    patientsService = moduleFixture.get(PatientsService);
    ordersService = moduleFixture.get(OrdersService);
    labCatalogService = moduleFixture.get(LabCatalogService);
    labWorkflowService = moduleFixture.get(LabWorkflowService);
    inventoryCatalogService = moduleFixture.get(InventoryCatalogService);
    pharmacyDispensingService = moduleFixture.get(PharmacyDispensingService);
    invoicesService = moduleFixture.get(InvoicesService);
    accountingService = moduleFixture.get(AccountingService);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  // DI-resolved services share the AppModule's single TenantContextService instance (see the
  // reporting spec for why ctx.inTenant() would not work here).
  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContextService.run(
      { tenantId: ctx.tenantId, correlationId: 'charge-capture-test' },
      work,
    );
  }

  // Some paths (e.g. cancel()'s reversal journal) need a resolvable actor — inTenant() above
  // deliberately has no accountId, matching a non-HTTP caller.
  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return tenantContextService.run(
      { tenantId: ctx.tenantId, accountId: STAFF_ID, correlationId: 'charge-capture-test' },
      work,
    );
  }

  async function makePatient(phoneNumber: string) {
    return inTenant(() =>
      patientsService.create({
        firstName: 'Capture',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Female',
        phoneNumber,
      }),
    );
  }

  async function makePricedLabTest(name: string, code: string, price: number) {
    const category = await inTenant(() => labCatalogService.createCategory({ name: `Cat ${name}` }));
    const test = await inTenant(() =>
      labCatalogService.createTest({ categoryId: category.id, name, code, specimenType: 'Blood', price }),
    );
    await inTenant(() => labCatalogService.createComponent(test.id, { name: 'Component 1' }));
    return test;
  }

  async function makeUnpricedLabTest(name: string, code: string) {
    const category = await inTenant(() => labCatalogService.createCategory({ name: `Cat ${name}` }));
    const test = await inTenant(() =>
      labCatalogService.createTest({ categoryId: category.id, name, code, specimenType: 'Blood' }),
    );
    await inTenant(() => labCatalogService.createComponent(test.id, { name: 'Component 1' }));
    return test;
  }

  async function completeLabOrderItem(patientId: string, test: { id: string; price: number | null }) {
    const order = await inTenant(() =>
      ordersService.create({
        patientId,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      }),
    );
    const orderItem = order.items[0];
    const requisition = await inTenant(() =>
      labWorkflowService.createRequisition({
        orderItemId: orderItem.id,
        testId: test.id,
        specimenType: 'Blood',
      }),
    );
    await inTenant(() => labWorkflowService.collectSample(requisition.id, STAFF_ID));
    const component = await inTenant(() => labCatalogService.listComponentsByTest(test.id));
    await inTenant(() =>
      labWorkflowService.enterResult(requisition.id, {
        componentId: component[0].id,
        value: '5.2',
        enteredBy: STAFF_ID,
      }),
    );
    await inTenant(() => labWorkflowService.verify(requisition.id, STAFF_ID));
    return { order, orderItem };
  }

  async function invoiceItemsFor(invoiceId: string): Promise<InvoiceItem[]> {
    return inTenant(() =>
      tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(InvoiceItem).find({ where: { invoiceId } }),
      ),
    );
  }

  async function journalForInvoiceItem(invoiceItemId: string) {
    return inTenant(() =>
      tenantConnection.runInTenantSchema(async (manager) => {
        const journal = await manager
          .getRepository(JournalEntry)
          .findOne({ where: { sourceType: 'InvoiceItem', sourceId: invoiceItemId } });
        if (!journal) {
          return null;
        }
        const lines = await manager.getRepository(JournalLine).find({ where: { journalId: journal.id } });
        return { ...journal, lines };
      }),
    );
  }

  it('captures a Lab charge onto a new invoice when the order item is verified', async () => {
    const patient = await makePatient('5560000001');
    const test = await makePricedLabTest('Priced CBC', 'PRICED-CBC', 250);

    await completeLabOrderItem(patient.id, test);

    const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
    expect(invoices.meta.total).toBe(1);
    const invoice = invoices.data[0];
    expect(invoice.subtotal).toBe(250);
    expect(invoice.taxableAmount).toBe(250);
    expect(invoice.totalAmount).toBe(250);
    expect(invoice.status).toBe('Unpaid');

    const items = await invoiceItemsFor(invoice.id);
    expect(items).toHaveLength(1);
    expect(items[0].unitPrice).toBe(250);
    expect(items[0].description).toBe('Priced CBC');
    expect(items[0].sourceOrderItemId).not.toBeNull();
  });

  it('accumulates subsequent charges onto the same open invoice', async () => {
    const patient = await makePatient('5560000002');
    const testA = await makePricedLabTest('Accum A', 'ACCUM-A', 100);
    const testB = await makePricedLabTest('Accum B', 'ACCUM-B', 150);

    await completeLabOrderItem(patient.id, testA);
    await completeLabOrderItem(patient.id, testB);

    const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
    expect(invoices.meta.total).toBe(1);
    const invoice = invoices.data[0];
    expect(invoice.subtotal).toBe(250);
    const items = await invoiceItemsFor(invoice.id);
    expect(items).toHaveLength(2);
  });

  it('skips unpriced items without charging and without failing the verification', async () => {
    const patient = await makePatient('5560000003');
    const test = await makeUnpricedLabTest('Unpriced', 'UNPRICED');

    const { order } = await completeLabOrderItem(patient.id, test);

    const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
    expect(invoices.meta.total).toBe(0);

    // The verification itself still succeeded (best-effort capture must not block the workflow).
    const requisitions = await inTenant(() =>
      labWorkflowService.listByOrderItem({ orderItemId: order.items[0].id }),
    );
    expect(requisitions.data[0].status).toBe('Verified');
  });

  it('is idempotent — the same order item is never charged twice', async () => {
    const patient = await makePatient('5560000004');
    const test = await makePricedLabTest('Idempotent', 'IDEMPOTENT', 80);
    const { orderItem } = await completeLabOrderItem(patient.id, test);

    const second = await inTenant(() =>
      tenantConnection.runInTenantSchema((manager) =>
        invoicesService.captureChargeForOrderItem(manager, {
          id: orderItem.id,
          orderId: orderItem.orderId,
          itemType: 'Lab',
          itemDescription: 'CBC',
        }),
      ),
    );
    expect(second.captured).toBe(false);
    expect(second.reason).toBe('already-charged');

    const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
    const items = await invoiceItemsFor(invoices.data[0].id);
    expect(items).toHaveLength(1);
  });

  it('captures a Pharmacy charge at the inventory item salePrice when dispensed', async () => {
    const patient = await makePatient('5560000005');
    const category = await inTenant(() => inventoryCatalogService.createCategory({ name: 'Drugs' }));
    const subCategory = await inTenant(() =>
      inventoryCatalogService.createSubCategory({ categoryId: category.id, name: 'Tablets' }),
    );
    const drug = await inTenant(() =>
      inventoryCatalogService.createItem({
        subCategoryId: subCategory.id,
        name: 'Paracetamol 500mg',
        code: 'PARA-500',
        unitOfMeasure: 'strip',
        salePrice: 45,
      }),
    );
    await inTenant(() =>
      tenantConnection.runInTenantSchema(async (manager) => {
        const batchRepository = manager.getRepository(StockBatch);
        const balanceRepository = manager.getRepository(StockBalance);
        const batch = await batchRepository.save(
          batchRepository.create({
            itemId: drug.id,
            batchNumber: 'CC-1',
            expiryDate: null,
            unitCost: String(30),
          }),
        );
        await balanceRepository.save(
          balanceRepository.create({
            itemId: drug.id,
            stockBatchId: batch.id,
            availableQuantity: String(10),
          }),
        );
      }),
    );

    const order = await inTenant(() =>
      ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Pharmacy', itemDescription: 'Paracetamol' }],
      }),
    );
    const dispensing = await inTenant(() =>
      pharmacyDispensingService.createDispensing({
        orderItemId: order.items[0].id,
        inventoryItemId: drug.id,
        quantity: 1,
      }),
    );
    await inTenant(() =>
      pharmacyDispensingService.dispenseDrug(dispensing.id, { dispensedBy: STAFF_ID }),
    );

    const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
    expect(invoices.meta.total).toBe(1);
    const invoice = invoices.data[0];
    expect(invoice.subtotal).toBe(45);
    const items = await invoiceItemsFor(invoice.id);
    expect(items).toHaveLength(1);
    expect(items[0].unitPrice).toBe(45);
    expect(items[0].sourceOrderItemId).toBe(order.items[0].id);
  });

  it('posts a Patient AR / Patient Service Revenue journal when a charge is captured', async () => {
    const patient = await makePatient('5560000006');
    const test = await makePricedLabTest('Ledger CBC', 'LEDGER-CBC', 300);
    await completeLabOrderItem(patient.id, test);

    const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
    const items = await invoiceItemsFor(invoices.data[0].id);
    const journal = await journalForInvoiceItem(items[0].id);

    expect(journal).not.toBeNull();
    expect(journal!.status).toBe('Posted');
    expect(journal!.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE)?.debit).toBe(300);
    expect(journal!.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE)?.credit).toBe(300);
  });

  it('a charge captured after a return does not silently re-inflate totalAmount back up', async () => {
    // Regression test for the P1 fix: createReturn now moves subtotal/taxableAmount in lockstep
    // with totalAmount, specifically so a later captureChargeForOrderItem — which recomputes
    // totalAmount from subtotal — can't erase the return's effect. Uses a partial payment/return
    // so the invoice stays PartiallyPaid (open) throughout, and the second charge lands on the
    // SAME invoice rather than opening a new one (a fully Paid invoice is no longer "open").
    const patient = await makePatient('5560000008');
    const testA = await makePricedLabTest('Return Then Capture A', 'RTC-A', 300);
    const testB = await makePricedLabTest('Return Then Capture B', 'RTC-B', 50);

    await completeLabOrderItem(patient.id, testA);
    const invoiceAfterFirstCharge = (await inTenant(() => invoicesService.list({ patientId: patient.id }))).data[0];
    expect(invoiceAfterFirstCharge.totalAmount).toBe(300);

    await inTenant(() =>
      invoicesService.recordPayment(invoiceAfterFirstCharge.id, { amount: 100, paymentMode: 'Cash', receivedBy: STAFF_ID }),
    );
    await inTenant(() =>
      invoicesService.createReturn(invoiceAfterFirstCharge.id, { amount: 100, reason: 'Partial return', returnedBy: STAFF_ID }),
    );
    const invoiceAfterReturn = await inTenant(() => invoicesService.findOne(invoiceAfterFirstCharge.id));
    expect(invoiceAfterReturn.status).toBe('PartiallyPaid'); // still open — the case the bug needs
    expect(invoiceAfterReturn.totalAmount).toBe(200);
    expect(invoiceAfterReturn.subtotal).toBe(200);

    await completeLabOrderItem(patient.id, testB);
    const invoiceAfterSecondCharge = await inTenant(() => invoicesService.findOne(invoiceAfterFirstCharge.id));
    // Before the fix: totalAmount recomputed from an untouched subtotal (300) + the new 50 line
    // would have come out to 350 — silently undoing the return. It must reflect only the
    // post-return balance plus the new charge.
    expect(invoiceAfterSecondCharge.totalAmount).toBe(250);
    expect(invoiceAfterSecondCharge.subtotal).toBe(250);
  });

  it('cancelling a charge-captured invoice reverses the Patient AR / Patient Service Revenue journal', async () => {
    const patient = await makePatient('5560000009');
    const test = await makePricedLabTest('Cancel Reversal', 'CANCEL-REV', 175);
    await completeLabOrderItem(patient.id, test);

    const invoice = (await inTenant(() => invoicesService.list({ patientId: patient.id }))).data[0];
    const items = await invoiceItemsFor(invoice.id);
    const originalJournal = await journalForInvoiceItem(items[0].id);
    expect(originalJournal).not.toBeNull();

    await withActor(() => invoicesService.cancel(invoice.id));

    const reversalJournal = await inTenant(() =>
      tenantConnection.runInTenantSchema(async (manager) => {
        const journal = await manager
          .getRepository(JournalEntry)
          .findOne({ where: { sourceType: 'InvoiceCancellation', sourceId: invoice.id } });
        if (!journal) return null;
        const lines = await manager.getRepository(JournalLine).find({ where: { journalId: journal.id } });
        return { ...journal, lines };
      }),
    );

    expect(reversalJournal).not.toBeNull();
    expect(reversalJournal!.status).toBe('Posted');
    expect(
      reversalJournal!.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE)?.debit,
    ).toBe(175);
    expect(
      reversalJournal!.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE)?.credit,
    ).toBe(175);
  });

  // Regression test for code-review-findings-2026-08-25.md's billing P2: captureChargeForOrderItem
  // read the open invoice with no row lock, unlike recordPayment/createReturn/cancel. A concurrent
  // recordPayment could commit paidAmount between that read and captureChargeForOrderItem's later
  // save() — which writes the FULL invoice row, including its stale in-memory paidAmount — silently
  // reverting the payment. Proven here by holding captureChargeForOrderItem's transaction open past
  // its own commit and asserting a concurrent recordPayment cannot complete until it does: with the
  // row lock in place, recordPayment's own SELECT ... FOR UPDATE on the same invoice row must block
  // for the duration, which Postgres guarantees deterministically (not a timing-dependent flake).
  it('row-locks the invoice so a concurrent recordPayment cannot complete until charge capture commits', async () => {
    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    const patient = await makePatient('5560000011');
    const existingTest = await makePricedLabTest('Lock Existing', 'LOCK-EXIST', 200);
    await completeLabOrderItem(patient.id, existingTest);
    const invoice = (await inTenant(() => invoicesService.list({ patientId: patient.id }))).data[0];

    // A second order item, driven up to a resulted requisition but never verified — so its charge
    // is captured only by the manual call below, never by the subscriber, giving full control over
    // timing (same technique the "idempotent" test above uses for its manual second call).
    const newTest = await makePricedLabTest('Lock New Charge', 'LOCK-NEW', 100);
    const order = await inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );
    const orderItem = order.items[0];
    const requisition = await inTenant(() =>
      labWorkflowService.createRequisition({ orderItemId: orderItem.id, testId: newTest.id, specimenType: 'Blood' }),
    );
    await inTenant(() => labWorkflowService.collectSample(requisition.id, STAFF_ID));
    const component = await inTenant(() => labCatalogService.listComponentsByTest(newTest.id));
    await inTenant(() =>
      labWorkflowService.enterResult(requisition.id, { componentId: component[0].id, value: '5.2', enteredBy: STAFF_ID }),
    );

    let captureStarted = false;
    let captureCommitted = false;
    const capturePromise = inTenant(() =>
      tenantConnection.runInTenantSchema(async (manager) => {
        captureStarted = true;
        const result = await invoicesService.captureChargeForOrderItem(manager, {
          id: orderItem.id,
          orderId: orderItem.orderId,
          itemType: 'Lab',
          itemDescription: 'CBC',
          completedBy: STAFF_ID,
        });
        await sleep(500); // hold the row lock open well past the SELECT ... FOR UPDATE
        captureCommitted = true;
        return result;
      }),
    );

    await sleep(300); // let charge capture acquire its lock first
    expect(captureStarted).toBe(true);
    const payment = await inTenant(() =>
      invoicesService.recordPayment(invoice.id, { amount: 50, paymentMode: 'Cash', receivedBy: STAFF_ID }),
    );

    // recordPayment's own row lock on the same invoice must have blocked it from completing until
    // captureChargeForOrderItem's transaction committed and released the row.
    expect(captureCommitted).toBe(true);
    expect(payment.amount).toBe(50);

    const captureResult = await capturePromise;
    expect(captureResult.captured).toBe(true);

    const finalInvoice = await inTenant(() => invoicesService.findOne(invoice.id));
    expect(finalInvoice.subtotal).toBe(300);
    expect(finalInvoice.paidAmount).toBe(50);
    expect(finalInvoice.status).toBe('PartiallyPaid');
  });

  it('best-effort: a revenue-posting failure does not roll back the clinical verification', async () => {
    // Simulates a ledger misconfiguration (the documented failure mode) by deactivating the
    // revenue account captureChargeForOrderItem posts to. Restored in finally so it doesn't leak
    // into the other tests sharing this tenant.
    await inTenant(() => accountingService.deactivateAccount(LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE));
    try {
      const patient = await makePatient('5560000007');
      const test = await makePricedLabTest('Unmapped CBC', 'UNMAPPED-CBC', 150);
      const { order } = await completeLabOrderItem(patient.id, test);

      // The clinical verification itself succeeded despite the ledger problem — the whole point
      // of best-effort posting.
      const requisitions = await inTenant(() =>
        labWorkflowService.listByOrderItem({ orderItemId: order.items[0].id }),
      );
      expect(requisitions.data[0].status).toBe('Verified');

      // Charge capture (the invoice item) is unaffected by the ledger failure...
      const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
      const items = await invoiceItemsFor(invoices.data[0].id);
      expect(items).toHaveLength(1);

      // ...but no revenue journal exists for it: the posting error was logged and swallowed, not
      // silently treated as success.
      const journal = await journalForInvoiceItem(items[0].id);
      expect(journal).toBeNull();
    } finally {
      await inTenant(() => accountingService.reactivateAccount(LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE));
    }
  });
});
