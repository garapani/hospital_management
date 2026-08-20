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

  it('captures a Lab charge onto a new invoice when the order item is verified', async () => {
    const patient = await makePatient('5560000001');
    const test = await makePricedLabTest('Priced CBC', 'PRICED-CBC', 250);

    await completeLabOrderItem(patient.id, test);

    const invoices = await inTenant(() => invoicesService.list({ patientId: patient.id }));
    expect(invoices.meta.total).toBe(1);
    const invoice = invoices.data[0];
    expect(invoice.subtotal).toBe(250);
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
});
