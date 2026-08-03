import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('OrdersService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let patientsService: PatientsService;
  let ordersService: OrdersService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'orders_svc' });
    tenantB = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence);
    ordersService = new OrdersService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  async function makePatient(tenantCtx: TenantTestContext, phoneNumber: string) {
    return tenantCtx.inTenant(() =>
      patientsService.create({
        firstName: 'Test',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber,
      }),
    );
  }

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000d1';

  it('creates an order with mixed-type items', async () => {
    const patient = await makePatient(ctx, '4440000001');

    const order = await ctx.inTenant(() =>
      ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [
          { itemType: 'Lab', itemDescription: 'CBC' },
          { itemType: 'Radiology', itemDescription: 'Chest X-ray', priority: 'Urgent' },
        ],
      }),
    );

    expect(order.id).toBeDefined();
    expect(order.items).toHaveLength(2);
    expect(order.items[0].status).toBe('Pending');
    expect(order.items[0].priority).toBe('Routine');
    expect(order.items[1].priority).toBe('Urgent');
    expect(order.items.map((i) => i.itemType).sort()).toEqual(['Lab', 'Radiology']);
  });

  it('rejects providing both sourceAppointmentId and sourceAdmissionId', async () => {
    const patient = await makePatient(ctx, '4440000002');

    await expect(
      ctx.inTenant(() =>
        ordersService.create({
          patientId: patient.id,
          orderedBy: DOCTOR_ID,
          sourceAppointmentId: '00000000-0000-0000-0000-000000000000',
          sourceAdmissionId: '00000000-0000-0000-0000-000000000000',
          items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects creating an order with no items', async () => {
    const patient = await makePatient(ctx, '4440000003');

    await expect(
      ctx.inTenant(() =>
        ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects creating an order for an unknown patientId', async () => {
    await expect(
      ctx.inTenant(() =>
        ordersService.create({
          patientId: '00000000-0000-0000-0000-000000000000',
          orderedBy: DOCTOR_ID,
          items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('completes an item independently of its siblings', async () => {
    const patient = await makePatient(ctx, '4440000004');
    const order = await ctx.inTenant(() =>
      ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [
          { itemType: 'Lab', itemDescription: 'CBC' },
          { itemType: 'Lab', itemDescription: 'LFT' },
        ],
      }),
    );
    const [firstItem, secondItem] = order.items;

    const completed = await ctx.inTenant(() =>
      ordersService.completeItem(order.id, firstItem.id, { completedBy: DOCTOR_ID }),
    );
    expect(completed.status).toBe('Completed');
    expect(completed.completedBy).toBe(DOCTOR_ID);
    expect(completed.completedAt).not.toBeNull();

    const refetched = await ctx.inTenant(() => ordersService.findOne(order.id));
    const stillPending = refetched.items.find((i) => i.id === secondItem.id);
    expect(stillPending?.status).toBe('Pending');
  });

  it('cancels an item with a reason', async () => {
    const patient = await makePatient(ctx, '4440000005');
    const order = await ctx.inTenant(() =>
      ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Pharmacy', itemDescription: 'Paracetamol 500mg' }],
      }),
    );

    const cancelled = await ctx.inTenant(() =>
      ordersService.cancelItem(order.id, order.items[0].id, { cancelReason: 'Duplicate order' }),
    );
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.cancelReason).toBe('Duplicate order');
  });

  it('rejects completing or cancelling an already-resolved item', async () => {
    const patient = await makePatient(ctx, '4440000006');
    const order = await ctx.inTenant(() =>
      ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      }),
    );
    const itemId = order.items[0].id;

    await ctx.inTenant(() => ordersService.completeItem(order.id, itemId, { completedBy: DOCTOR_ID }));

    await expect(
      ctx.inTenant(() => ordersService.completeItem(order.id, itemId, { completedBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => ordersService.cancelItem(order.id, itemId, {})),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when completing an item under the wrong order id', async () => {
    const patient = await makePatient(ctx, '4440000007');
    const orderA = await ctx.inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );
    const orderB = await ctx.inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'LFT' }] }),
    );

    await expect(
      ctx.inTenant(() => ordersService.completeItem(orderB.id, orderA.items[0].id, { completedBy: DOCTOR_ID })),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists orders filtered by patientId', async () => {
    const patientA = await makePatient(tenantB, '4440000008');
    const patientB = await makePatient(tenantB, '4440000009');
    await tenantB.inTenant(() =>
      ordersService.create({ patientId: patientA.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );
    await tenantB.inTenant(() =>
      ordersService.create({ patientId: patientB.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'LFT' }] }),
    );

    const filtered = await tenantB.inTenant(() => ordersService.list(patientA.id));
    expect(filtered.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].patientId).toBe(patientA.id);
    expect(filtered.page).toBe(1);
    expect(filtered.limit).toBe(20);
  });

  it('paginates orders using page and limit', async () => {
    const patient = await makePatient(ctx, '4440000011');
    for (const description of ['CBC', 'LFT', 'RFT']) {
      await ctx.inTenant(() =>
        ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: description }] }),
      );
    }

    const firstPage = await ctx.inTenant(() => ordersService.list(patient.id, 1, 2));
    expect(firstPage.total).toBe(3);
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.page).toBe(1);
    expect(firstPage.limit).toBe(2);

    const secondPage = await ctx.inTenant(() => ordersService.list(patient.id, 2, 2));
    expect(secondPage.total).toBe(3);
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.page).toBe(2);

    const firstPageIds = firstPage.data.map((order) => order.id);
    expect(firstPageIds).not.toContain(secondPage.data[0].id);
  });

  it('caps limit at 100 even when a larger value is requested', async () => {
    const patient = await makePatient(ctx, '4440000012');
    await ctx.inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );

    const result = await ctx.inTenant(() => ordersService.list(patient.id, 1, 500));
    expect(result.limit).toBe(100);
  });

  it('throws NotFoundException for an unknown order id', async () => {
    await expect(
      ctx.inTenant(() => ordersService.findOne('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces tenant isolation for orders', async () => {
    const patient = await makePatient(ctx, '4440000010');
    const order = await ctx.inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );

    await expect(
      tenantB.inTenant(() => ordersService.findOne(order.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
