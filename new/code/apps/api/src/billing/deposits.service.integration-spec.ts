import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { DepositsService } from './deposits.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';

describe('DepositsService (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let patientsService: PatientsService;
  let depositsService: DepositsService;

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
    depositsService = new DepositsService(tenantConnection);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({ hospitalId: `deposits_1_${uniqueId}`, hospitalName: 'Deposits Hospital 1' });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({ hospitalId: `deposits_2_${uniqueId}`, hospitalName: 'Deposits Hospital 2' });
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

  const STAFF_ID = '00000000-0000-0000-0000-0000000000f1';

  it('creates a deposit with balance equal to the amount received', async () => {
    const patient = await makePatient(tenantId1, '6660000001');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
    );
    expect(deposit.amount).toBe(5000);
    expect(deposit.balance).toBe(5000);
    expect(deposit.patientId).toBe(patient.id);
  });

  it('rejects a deposit amount of zero or less', async () => {
    const patient = await makePatient(tenantId1, '6660000002');
    await expect(
      inTenant(tenantId1, () => depositsService.create({ patientId: patient.id, amount: 0, receivedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a deposit for an unknown patient', async () => {
    await expect(
      inTenant(tenantId1, () =>
        depositsService.create({ patientId: '00000000-0000-0000-0000-000000000000', amount: 1000, receivedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists deposits filtered by patientId, paginated', async () => {
    const patientA = await makePatient(tenantId2, '6660000003');
    const patientB = await makePatient(tenantId2, '6660000004');
    await inTenant(tenantId2, () => depositsService.create({ patientId: patientA.id, amount: 1000, receivedBy: STAFF_ID }));
    await inTenant(tenantId2, () => depositsService.create({ patientId: patientB.id, amount: 2000, receivedBy: STAFF_ID }));

    const filtered = await inTenant(tenantId2, () => depositsService.list(patientA.id));
    expect(filtered.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].patientId).toBe(patientA.id);
  });

  it('partially refunds a deposit, decrementing its balance', async () => {
    const patient = await makePatient(tenantId1, '6660000005');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
    );
    const refunded = await inTenant(tenantId1, () =>
      depositsService.refund(deposit.id, { amount: 2000, refundedBy: STAFF_ID }),
    );
    expect(refunded.balance).toBe(3000);
  });

  it('fully refunds a deposit down to a zero balance', async () => {
    const patient = await makePatient(tenantId1, '6660000006');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 1500, receivedBy: STAFF_ID }),
    );
    const refunded = await inTenant(tenantId1, () =>
      depositsService.refund(deposit.id, { amount: 1500, refundedBy: STAFF_ID }),
    );
    expect(refunded.balance).toBe(0);
  });

  it('records the refunding actor and timestamp on refund', async () => {
    const patient = await makePatient(tenantId1, '6660000010');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    const before = Date.now();
    const refunded = await inTenant(tenantId1, () =>
      depositsService.refund(deposit.id, { amount: 500, refundedBy: STAFF_ID }),
    );
    expect(refunded.refundedBy).toBe(STAFF_ID);
    expect(refunded.refundedAt).not.toBeNull();
    expect(new Date(refunded.refundedAt as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('rejects refunding more than the current balance', async () => {
    const patient = await makePatient(tenantId1, '6660000007');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    await expect(
      inTenant(tenantId1, () => depositsService.refund(deposit.id, { amount: 1500, refundedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects refunding a zero or negative amount', async () => {
    const patient = await makePatient(tenantId1, '6660000008');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    await expect(
      inTenant(tenantId1, () => depositsService.refund(deposit.id, { amount: 0, refundedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException refunding an unknown deposit id', async () => {
    await expect(
      inTenant(tenantId1, () =>
        depositsService.refund('00000000-0000-0000-0000-000000000000', { amount: 100, refundedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces tenant isolation for deposits', async () => {
    const patient = await makePatient(tenantId1, '6660000009');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    await expect(
      inTenant(tenantId2, () => depositsService.refund(deposit.id, { amount: 100, refundedBy: STAFF_ID })),
    ).rejects.toThrow(NotFoundException);
  });
});
