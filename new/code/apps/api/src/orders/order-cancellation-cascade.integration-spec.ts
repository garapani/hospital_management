import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app/app.module.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PatientsService } from '../patients/patients.service.js';
import { OrdersService } from './orders.service.js';
import { LabCatalogService } from '../lab/lab-catalog.service.js';
import { LabWorkflowService } from '../lab/lab-workflow.service.js';
import { RadiologyCatalogService } from '../radiology/radiology-catalog.service.js';
import { RadiologyWorkflowService } from '../radiology/radiology-workflow.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { PharmacyDispensingService } from '../pharmacy/pharmacy-dispensing.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

/**
 * Regression coverage for code-review-findings-2026-08-25's orders P2: cancelling an order item
 * left its downstream Lab/Radiology requisition or Pharmacy dispensing live, with no cascade.
 * Fixed via per-module TypeORM subscribers (LabOrderCancellationSubscriber etc.) reacting to the
 * order_items status transition — see those files for the design rationale.
 */
describe('Order-item cancellation cascade (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let tenantContextService: TenantContextService;

  let patientsService: PatientsService;
  let ordersService: OrdersService;
  let labCatalogService: LabCatalogService;
  let labWorkflowService: LabWorkflowService;
  let radiologyCatalogService: RadiologyCatalogService;
  let radiologyWorkflowService: RadiologyWorkflowService;
  let inventoryCatalogService: InventoryCatalogService;
  let pharmacyDispensingService: PharmacyDispensingService;

  const DOCTOR_ID = '00000000-0000-0000-0000-000000000001';
  const STAFF_ID = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ctx = await setupTenantTestContext({ namePrefix: 'order_cascade' });

    tenantContextService = moduleFixture.get(TenantContextService);
    patientsService = moduleFixture.get(PatientsService);
    ordersService = moduleFixture.get(OrdersService);
    labCatalogService = moduleFixture.get(LabCatalogService);
    labWorkflowService = moduleFixture.get(LabWorkflowService);
    radiologyCatalogService = moduleFixture.get(RadiologyCatalogService);
    radiologyWorkflowService = moduleFixture.get(RadiologyWorkflowService);
    inventoryCatalogService = moduleFixture.get(InventoryCatalogService);
    pharmacyDispensingService = moduleFixture.get(PharmacyDispensingService);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContextService.run(
      { tenantId: ctx.tenantId, correlationId: 'order-cascade-test' },
      work,
    );
  }

  async function makePatient(phoneNumber: string) {
    return inTenant(() =>
      patientsService.create({
        firstName: 'Cascade',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Female',
        phoneNumber,
      }),
    );
  }

  it('cancels a still-Pending Lab requisition when its order item is cancelled', async () => {
    const patient = await makePatient('5570000001');
    const category = await inTenant(() => labCatalogService.createCategory({ name: 'Cascade Cat A' }));
    const test = await inTenant(() =>
      labCatalogService.createTest({ categoryId: category.id, name: 'Cascade CBC', code: 'CASCADE-CBC', specimenType: 'Blood' }),
    );
    await inTenant(() => labCatalogService.createComponent(test.id, { name: 'Component 1' }));

    const order = await inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );
    const requisition = await inTenant(() =>
      labWorkflowService.createRequisition({ orderItemId: order.items[0].id, testId: test.id, specimenType: 'Blood' }),
    );

    await inTenant(() => ordersService.cancelItem(order.id, order.items[0].id, { cancelReason: 'Patient declined' }));

    const refetched = await inTenant(() => labWorkflowService.findOne(requisition.id));
    expect(refetched.status).toBe('Cancelled');
    expect(refetched.cancelReason).toBe('Order item cancelled');
  });

  it('does not touch an already-Verified Lab requisition when its order item is later cancelled', async () => {
    // completeItem rejects cancelling an already-Completed item, but the cascade itself must also
    // never clobber a terminal-state requisition — belt-and-suspenders against a future caller
    // that bypasses the order-item guard.
    const patient = await makePatient('5570000002');
    const category = await inTenant(() => labCatalogService.createCategory({ name: 'Cascade Cat B' }));
    const test = await inTenant(() =>
      labCatalogService.createTest({ categoryId: category.id, name: 'Cascade LFT', code: 'CASCADE-LFT', specimenType: 'Blood' }),
    );
    await inTenant(() => labCatalogService.createComponent(test.id, { name: 'Component 1' }));

    const order = await inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'LFT' }] }),
    );
    const requisition = await inTenant(() =>
      labWorkflowService.createRequisition({ orderItemId: order.items[0].id, testId: test.id, specimenType: 'Blood' }),
    );
    await inTenant(() => labWorkflowService.collectSample(requisition.id, STAFF_ID));
    const components = await inTenant(() => labCatalogService.listComponentsByTest(test.id));
    await inTenant(() =>
      labWorkflowService.enterResult(requisition.id, { componentId: components[0].id, value: '5.2', enteredBy: STAFF_ID }),
    );
    await inTenant(() => labWorkflowService.verify(requisition.id, STAFF_ID));

    // The order item is now Completed (verify() completes it), so cancelItem correctly rejects —
    // proving the requisition can never be reached via this path. Confirms the guard, not the
    // cascade itself, is what protects a Verified requisition in practice.
    await expect(
      inTenant(() => ordersService.cancelItem(order.id, order.items[0].id, {})),
    ).rejects.toThrow();

    const refetched = await inTenant(() => labWorkflowService.findOne(requisition.id));
    expect(refetched.status).toBe('Verified');
  });

  it('cancels a still-Pending Radiology requisition when its order item is cancelled', async () => {
    const patient = await makePatient('5570000003');
    const type = await inTenant(() => radiologyCatalogService.createType({ name: 'Cascade X-ray Type' }));
    const item = await inTenant(() => radiologyCatalogService.createItem({ imagingTypeId: type.id, name: 'Chest X-ray Cascade' }));

    const order = await inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Radiology', itemDescription: 'Chest X-ray' }] }),
    );
    const requisition = await inTenant(() =>
      radiologyWorkflowService.createRequisition({ orderItemId: order.items[0].id, imagingItemId: item.id }),
    );

    await inTenant(() => ordersService.cancelItem(order.id, order.items[0].id, {}));

    const refetched = await inTenant(() => radiologyWorkflowService.findOne(requisition.id));
    expect(refetched.status).toBe('Cancelled');
    expect(refetched.cancelReason).toBe('Order item cancelled');
  });

  it('cancels a still-Pending Pharmacy dispensing when its order item is cancelled', async () => {
    const patient = await makePatient('5570000004');
    const category = await inTenant(() => inventoryCatalogService.createCategory({ name: 'Cascade Drugs' }));
    const subCategory = await inTenant(() =>
      inventoryCatalogService.createSubCategory({ categoryId: category.id, name: 'Cascade Tablets' }),
    );
    const drug = await inTenant(() =>
      inventoryCatalogService.createItem({
        subCategoryId: subCategory.id,
        name: 'Cascade Paracetamol',
        code: 'CASCADE-PARA',
        unitOfMeasure: 'strip',
        salePrice: 45,
      }),
    );

    const order = await inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Pharmacy', itemDescription: 'Paracetamol' }] }),
    );
    const dispensing = await inTenant(() =>
      pharmacyDispensingService.createDispensing({ orderItemId: order.items[0].id, inventoryItemId: drug.id, quantity: 1 }),
    );

    await inTenant(() => ordersService.cancelItem(order.id, order.items[0].id, {}));

    const refetched = await inTenant(() => pharmacyDispensingService.findOne(dispensing.id));
    expect(refetched.status).toBe('Cancelled');
    expect(refetched.cancelReason).toBe('Order item cancelled');
  });
});
