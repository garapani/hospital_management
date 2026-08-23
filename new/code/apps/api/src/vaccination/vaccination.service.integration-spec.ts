import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VaccinationService } from './vaccination.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('VaccinationService (integration)', () => {
  let ctx: TenantTestContext;
  let vaccinationService: VaccinationService;
  let patientsService: PatientsService;

  const STAFF_ID = '00000000-0000-0000-0000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'vaccination' });
    vaccinationService = new VaccinationService(ctx.tenantConnection, ctx.tenantContext);
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'vaccination-test' },
      work,
    );
  }

  let seq = 0;
  async function makePatient() {
    seq += 1;
    return ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Vaccinee',
        lastName: `Patient${seq}`,
        dateOfBirth: '2020-01-15',
        gender: 'Male',
        phoneNumber: `5580000${String(seq).padStart(3, '0')}`,
      }),
    );
  }

  async function makeRecord(patientId: string, overrides: Record<string, unknown> = {}) {
    seq += 1;
    return ctx.inTenant(() =>
      vaccinationService.record({
        patientId,
        vaccine: `Hepatitis B ${seq}`,
        doseNumber: 1,
        administeredDate: '2025-03-10',
        batchNumber: `BATCH-${seq}`,
        notes: `Dose ${seq} of the series`,
        // No authenticated principal in ctx.inTenant — the §25 fallback supplies the actor.
        administeredBy: STAFF_ID,
        ...overrides,
      }),
    );
  }

  it('records a vaccination against a real patient with sensible defaults', async () => {
    const patient = await makePatient();
    const record = await makeRecord(patient.id);
    expect(record.id).toBeDefined();
    expect(record.patientId).toBe(patient.id);
    expect(record.vaccine).toBe('Hepatitis B 2');
    expect(record.doseNumber).toBe(1);
    expect(record.administeredDate).toBe('2025-03-10');
    expect(record.batchNumber).toBe('BATCH-2');
    expect(record.notes).toBe('Dose 2 of the series');
    expect(record.administeredBy).toBe(STAFF_ID); // no authenticated principal -> fallback
  });

  it('validates input and rejects unknown patients', async () => {
    const patient = await makePatient();

    await expect(
      ctx.inTenant(() =>
        vaccinationService.record({ patientId: patient.id, vaccine: '   ', administeredDate: '2025-03-10' }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      ctx.inTenant(() =>
        vaccinationService.record({ patientId: patient.id, vaccine: 'Polio', doseNumber: 0, administeredDate: '2025-03-10' }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        vaccinationService.record({ patientId: patient.id, vaccine: 'Polio', doseNumber: -2, administeredDate: '2025-03-10' }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      ctx.inTenant(() =>
        vaccinationService.record({
          patientId: patient.id,
          vaccine: 'Polio',
          administeredDate: undefined as unknown as string,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        vaccinationService.record({ patientId: patient.id, vaccine: 'Polio', administeredDate: 'not-a-date' }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      ctx.inTenant(() =>
        vaccinationService.record({
          patientId: '00000000-0000-0000-0000-000000000000',
          vaccine: 'Polio',
          administeredDate: '2025-03-10',
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      ctx.inTenant(() => vaccinationService.getRecord('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('derives administeredBy from the authenticated principal (section 25)', async () => {
    const patient = await makePatient();
    const spoofed = '00000000-0000-0000-0000-0000000000ff';
    const record = await withActor(() =>
      vaccinationService.record({
        patientId: patient.id,
        vaccine: 'BCG',
        administeredDate: '2025-04-01',
        administeredBy: spoofed,
      }),
    );
    // The authenticated principal wins over any caller-supplied value.
    expect(record.administeredBy).toBe(AUTHENTICATED_ACCOUNT);

    const fetched = await ctx.inTenant(() => vaccinationService.getRecord(record.id));
    expect(fetched.administeredBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('lists records paginated, filtered by patient and vaccine, newest administeredDate first', async () => {
    const patientA = await makePatient();
    const patientB = await makePatient();

    const older = await makeRecord(patientA.id, {
      vaccine: 'MMR',
      administeredDate: '2025-01-05',
      doseNumber: 1,
    });
    const newer = await makeRecord(patientA.id, {
      vaccine: 'MMR',
      administeredDate: '2025-06-20',
      doseNumber: 2,
    });
    const otherVaccine = await makeRecord(patientA.id, {
      vaccine: 'Tetanus',
      administeredDate: '2025-03-15',
    });
    const otherPatient = await makeRecord(patientB.id, {
      vaccine: 'MMR',
      administeredDate: '2025-02-10',
    });

    // Filter by patient: newest administeredDate first.
    const byPatient = await ctx.inTenant(() =>
      vaccinationService.listRecords({ patientId: patientA.id }),
    );
    expect(byPatient.meta.total).toBe(3);
    expect(byPatient.data.map((r) => r.id)).toEqual([newer.id, otherVaccine.id, older.id]);

    // Filter by patient + vaccine.
    const mmr = await ctx.inTenant(() =>
      vaccinationService.listRecords({ patientId: patientA.id, vaccine: 'MMR' }),
    );
    expect(mmr.meta.total).toBe(2);
    expect(mmr.data.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(mmr.data[0].doseNumber).toBe(2);

    // Filter by vaccine alone spans patients.
    const allMmr = await ctx.inTenant(() => vaccinationService.listRecords({ vaccine: 'MMR' }));
    expect(allMmr.meta.total).toBe(3);
    expect(allMmr.data.map((r) => r.id)).toContain(otherPatient.id);

    // Pagination shape: limit respected, totalPages derived from the tenant-wide total.
    const page = await ctx.inTenant(() => vaccinationService.listRecords({ page: 1, limit: 2 }));
    expect(page.data).toHaveLength(2);
    expect(page.meta.page).toBe(1);
    expect(page.meta.limit).toBe(2);
    expect(page.meta.total).toBeGreaterThanOrEqual(4);
    expect(page.meta.totalPages).toBe(Math.ceil(page.meta.total / 2));
  });

  it('enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const patient = await makePatient();
    const record = await makeRecord(patient.id, { vaccine: 'Isolation Only' });

    await expect(tenantB.inTenant(() => vaccinationService.getRecord(record.id))).rejects.toThrow(
      NotFoundException,
    );
    const list = await tenantB.inTenant(() => vaccinationService.listRecords({}));
    expect(list.data.map((r) => r.id)).not.toContain(record.id);
  });
});
