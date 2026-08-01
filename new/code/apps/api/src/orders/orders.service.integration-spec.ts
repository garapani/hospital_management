import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { OrdersService } from './orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';

describe('OrdersService (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let patientsService: PatientsService;
  let ordersService: OrdersService;

  let tenantId1: string;
  let tenantId2: string;

  beforeAll(async () => {
    await dataSource.initialize();

    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    const tenantsService = new TenantsService(dataSource);
    const patientSequence = new PatientNumberGeneratorService(tenantConnection);
    patientsService = new PatientsService(tenantConnection, patientSequence);
    ordersService = new OrdersService(tenantConnection);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({ hospitalId: `orders_1_${uniqueId}`, hospitalName: 'Orders Hospital 1' });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({ hospitalId: `orders_2_${uniqueId}`, hospitalName: 'Orders Hospital 2' });
    tenantId2 = t2.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId2);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId, correlationId: 'test' }, work);
  }

  async function makePatient(tenantId: string, phoneNumber: string) {
    return inTenant(tenantId, () =>
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
    const patient = await makePatient(tenantId1, '4440000001');

    const order = await inTenant(tenantId1, () =>
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
    const patient = await makePatient(tenantId1, '4440000002');

    await expect(
      inTenant(tenantId1, () =>
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
    const patient = await makePatient(tenantId1, '4440000003');

    await expect(
      inTenant(tenantId1, () =>
        ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects creating an order for an unknown patientId', async () => {
    await expect(
      inTenant(tenantId1, () =>
        ordersService.create({
          patientId: '00000000-0000-0000-0000-000000000000',
          orderedBy: DOCTOR_ID,
          items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('completes an item independently of its siblings', async () => {
    const patient = await makePatient(tenantId1, '4440000004');
    const order = await inTenant(tenantId1, () =>
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

    const completed = await inTenant(tenantId1, () =>
      ordersService.completeItem(order.id, firstItem.id, { completedBy: DOCTOR_ID }),
    );
    expect(completed.status).toBe('Completed');
    expect(completed.completedBy).toBe(DOCTOR_ID);
    expect(completed.completedAt).not.toBeNull();

    const refetched = await inTenant(tenantId1, () => ordersService.findOne(order.id));
    const stillPending = refetched.items.find((i) => i.id === secondItem.id);
    expect(stillPending?.status).toBe('Pending');
  });

  it('cancels an item with a reason', async () => {
    const patient = await makePatient(tenantId1, '4440000005');
    const order = await inTenant(tenantId1, () =>
      ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Pharmacy', itemDescription: 'Paracetamol 500mg' }],
      }),
    );

    const cancelled = await inTenant(tenantId1, () =>
      ordersService.cancelItem(order.id, order.items[0].id, { cancelReason: 'Duplicate order' }),
    );
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.cancelReason).toBe('Duplicate order');
  });

  it('rejects completing or cancelling an already-resolved item', async () => {
    const patient = await makePatient(tenantId1, '4440000006');
    const order = await inTenant(tenantId1, () =>
      ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      }),
    );
    const itemId = order.items[0].id;

    await inTenant(tenantId1, () => ordersService.completeItem(order.id, itemId, { completedBy: DOCTOR_ID }));

    await expect(
      inTenant(tenantId1, () => ordersService.completeItem(order.id, itemId, { completedBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
    await expect(
      inTenant(tenantId1, () => ordersService.cancelItem(order.id, itemId, {})),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when completing an item under the wrong order id', async () => {
    const patient = await makePatient(tenantId1, '4440000007');
    const orderA = await inTenant(tenantId1, () =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );
    const orderB = await inTenant(tenantId1, () =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'LFT' }] }),
    );

    await expect(
      inTenant(tenantId1, () => ordersService.completeItem(orderB.id, orderA.items[0].id, { completedBy: DOCTOR_ID })),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists orders filtered by patientId', async () => {
    const patientA = await makePatient(tenantId2, '4440000008');
    const patientB = await makePatient(tenantId2, '4440000009');
    await inTenant(tenantId2, () =>
      ordersService.create({ patientId: patientA.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );
    await inTenant(tenantId2, () =>
      ordersService.create({ patientId: patientB.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'LFT' }] }),
    );

    const filtered = await inTenant(tenantId2, () => ordersService.list(patientA.id));
    expect(filtered.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].patientId).toBe(patientA.id);
    expect(filtered.page).toBe(1);
    expect(filtered.limit).toBe(20);
  });

  it('throws NotFoundException for an unknown order id', async () => {
    await expect(
      inTenant(tenantId1, () => ordersService.findOne('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces tenant isolation for orders', async () => {
    const patient = await makePatient(tenantId1, '4440000010');
    const order = await inTenant(tenantId1, () =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );

    await expect(
      inTenant(tenantId2, () => ordersService.findOne(order.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
