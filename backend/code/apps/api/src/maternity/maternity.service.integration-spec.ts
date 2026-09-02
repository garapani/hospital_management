import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MaternityService } from './maternity.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { PdfService } from '@hospital/pdf';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('MaternityService (integration)', () => {
  let ctx: TenantTestContext;
  let maternityService: MaternityService;
  let patientsService: PatientsService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'maternity' });
    maternityService = new MaternityService(ctx.tenantConnection, ctx.tenantContext);
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
      new PdfService(),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'maternity-test' },
      work,
    );
  }

  let seq = 0;

  async function makePatient() {
    seq += 1;
    return ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Maternity',
        lastName: `Patient${seq}`,
        dateOfBirth: '1992-02-02',
        gender: 'Female',
        phoneNumber: `9988${String(seq).padStart(6, '0')}`,
      }),
    );
  }

  /** Inserts an admission row directly — maternity validates existence/ownership via raw query. */
  async function makeAdmission(patientId: string): Promise<string> {
    seq += 1;
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO admissions ("patientId", "admissionSource", "admittingDoctorId", "wardId", "bedId")
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            patientId,
            'OPD',
            STAFF_ID,
            '00000000-0000-4000-8000-0000000000c2',
            `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
          ],
        ),
      ),
    );
    return rows[0].id;
  }

  /** admissions.patientId is unique while status='Admitted' — discharge first when a test needs
   *  a second admission (and thus a second maternity record, now one-per-admission) for the same
   *  patient. */
  async function dischargeAdmission(admissionId: string): Promise<void> {
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(`UPDATE admissions SET status = 'Discharged' WHERE id = $1`, [admissionId]),
      ),
    );
  }

  async function makeRecord(patientId: string, overrides: Record<string, unknown> = {}) {
    const admissionId = await makeAdmission(patientId);
    return ctx.inTenant(() =>
      maternityService.createRecord({
        admissionId,
        patientId,
        gravida: 2,
        para: 1,
        lmp: '2025-06-01',
        edd: '2026-03-08',
        ...overrides,
      }),
    );
  }

  it('creates an antenatal record, leaving the delivery outcome null', async () => {
    const patient = await makePatient();
    const admissionId = await makeAdmission(patient.id);

    const record = await ctx.inTenant(() =>
      maternityService.createRecord({
        admissionId,
        patientId: patient.id,
        gravida: 3,
        para: 2,
        lmp: '2025-05-01',
        edd: '2026-02-05',
        notes: 'First pregnancy',
      }),
    );
    expect(record.gravida).toBe(3);
    expect(record.para).toBe(2);
    expect(record.lmp).toBe('2025-05-01');
    expect(record.edd).toBe('2026-02-05');
    expect(record.notes).toBe('First pregnancy');
    // No delivery outcome at create — deliveredBy stays null until recordDelivery.
    expect(record.deliveryDate).toBeNull();
    expect(record.deliveryType).toBeNull();
    expect(record.babyCount).toBe(0);
    expect(record.complications).toBeNull();
    expect(record.deliveredBy).toBeNull();

    // Defaults for omitted antenatal fields — a distinct admission, since a maternity record is
    // now at most one per admission.
    await dischargeAdmission(admissionId);
    const secondAdmissionId = await makeAdmission(patient.id);
    const minimal = await ctx.inTenant(() =>
      maternityService.createRecord({ admissionId: secondAdmissionId, patientId: patient.id }),
    );
    expect(minimal.gravida).toBe(0);
    expect(minimal.para).toBe(0);
    expect(minimal.deliveryDate).toBeNull();
    expect(minimal.deliveredBy).toBeNull();
  });

  it('records a delivery, deriving the delivering actor from the authenticated principal', async () => {
    const patient = await makePatient();
    const record = await makeRecord(patient.id);

    const delivered = await withActor(() =>
      maternityService.recordDelivery(record.id, {
        deliveryDate: '2026-02-10',
        deliveryType: 'Normal',
        babyCount: 1,
        complications: 'None',
        notes: 'Uncomplicated vaginal delivery',
        deliveredBy: 'spoofed', // §25: the principal wins over any caller-supplied value.
      }),
    );
    expect(delivered.deliveryDate).toBe('2026-02-10');
    expect(delivered.deliveryType).toBe('Normal');
    expect(delivered.babyCount).toBe(1);
    expect(delivered.complications).toBe('None');
    expect(delivered.notes).toBe('Uncomplicated vaginal delivery');
    expect(delivered.deliveredBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('falls back to the caller-supplied actor without a tenant context', async () => {
    const patient = await makePatient();
    const record = await makeRecord(patient.id);

    const delivered = await ctx.inTenant(() =>
      maternityService.recordDelivery(record.id, {
        deliveryDate: '2026-02-11',
        deliveryType: 'Instrumental',
        babyCount: 2,
        deliveredBy: STAFF_ID,
      }),
    );
    expect(delivered.deliveryDate).toBe('2026-02-11');
    expect(delivered.deliveryType).toBe('Instrumental');
    expect(delivered.babyCount).toBe(2);
    expect(delivered.deliveredBy).toBe(STAFF_ID);
  });

  it('rejects recording a delivery twice', async () => {
    const patient = await makePatient();
    const record = await makeRecord(patient.id);
    await withActor(() =>
      maternityService.recordDelivery(record.id, {
        deliveryDate: '2026-02-10',
        deliveryType: 'C-Section',
        babyCount: 1,
      }),
    );
    await expect(
      withActor(() =>
        maternityService.recordDelivery(record.id, {
          deliveryDate: '2026-02-11',
          deliveryType: 'Normal',
          babyCount: 1,
        }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('updates antenatal fields before delivery but rejects edits afterwards', async () => {
    const patient = await makePatient();
    const record = await makeRecord(patient.id);

    const updated = await ctx.inTenant(() =>
      maternityService.updateRecord(record.id, {
        gravida: 4,
        para: 3,
        lmp: '2025-07-01',
        edd: '2026-04-01',
        notes: 'Twins expected',
      }),
    );
    expect(updated.gravida).toBe(4);
    expect(updated.para).toBe(3);
    expect(updated.lmp).toBe('2025-07-01');
    expect(updated.edd).toBe('2026-04-01');
    expect(updated.notes).toBe('Twins expected');
    expect(updated.deliveryDate).toBeNull();

    // Partial PATCH keeps the untouched fields.
    const partial = await ctx.inTenant(() =>
      maternityService.updateRecord(record.id, { gravida: 5 }),
    );
    expect(partial.gravida).toBe(5);
    expect(partial.para).toBe(3);

    await ctx.inTenant(() =>
      maternityService.recordDelivery(record.id, {
        deliveryDate: '2026-02-10',
        deliveryType: 'Normal',
        babyCount: 2,
        deliveredBy: STAFF_ID,
      }),
    );
    // The record is immutable once the delivery is recorded.
    await expect(
      ctx.inTenant(() => maternityService.updateRecord(record.id, { gravida: 6 })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => maternityService.updateRecord(record.id, { notes: 'edited' })),
    ).rejects.toThrow(ConflictException);
  });

  it('validates antenatal inputs and the admission reference', async () => {
    const patient = await makePatient();
    const admissionId = await makeAdmission(patient.id);

    await expect(
      ctx.inTenant(() =>
        maternityService.createRecord({ admissionId, patientId: patient.id, gravida: -1 }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        maternityService.createRecord({ admissionId, patientId: patient.id, para: -1 }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        maternityService.createRecord({
          admissionId,
          patientId: patient.id,
          lmp: '2026-03-01',
          edd: '2026-02-01',
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    // Update validation mirrors create (merged-state lmp/edd check). Uses a fresh patient:
    // `patient` above already holds an active admission, and a patient can only hold one.
    const updatePatient = await makePatient();
    const record = await makeRecord(updatePatient.id);
    await expect(
      ctx.inTenant(() =>
        maternityService.updateRecord(record.id, { lmp: '2026-05-01' }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        maternityService.updateRecord(record.id, { para: -2 }),
      ),
    ).rejects.toThrow(BadRequestException);

    // Unknown admission -> NotFound.
    await expect(
      ctx.inTenant(() =>
        maternityService.createRecord({
          admissionId: '00000000-0000-0000-0000-000000000000',
          patientId: patient.id,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a record whose admission belongs to a different patient', async () => {
    const patientA = await makePatient();
    const patientB = await makePatient();
    const admissionId = await makeAdmission(patientA.id);

    await expect(
      ctx.inTenant(() =>
        maternityService.createRecord({ admissionId, patientId: patientB.id }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a second maternity record for the same admission', async () => {
    const patient = await makePatient();
    const record = await makeRecord(patient.id);

    await expect(
      ctx.inTenant(() =>
        maternityService.createRecord({ admissionId: record.admissionId, patientId: record.patientId }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('paginates listed records', async () => {
    const patient = await makePatient();
    let lastAdmissionId = await makeAdmission(patient.id);
    await ctx.inTenant(() =>
      maternityService.createRecord({ admissionId: lastAdmissionId, patientId: patient.id }),
    );
    for (let i = 0; i < 2; i++) {
      await dischargeAdmission(lastAdmissionId);
      lastAdmissionId = await makeAdmission(patient.id);
      await ctx.inTenant(() =>
        maternityService.createRecord({ admissionId: lastAdmissionId, patientId: patient.id }),
      );
    }

    const page1 = await ctx.inTenant(() =>
      maternityService.listRecords({ patientId: patient.id, page: 1, limit: 2 }),
    );
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(3);
    expect(page1.meta.totalPages).toBe(2);
  });

  it('validates delivery inputs', async () => {
    const patient = await makePatient();
    const record = await makeRecord(patient.id);

    // deliveryDate is required.
    await expect(
      ctx.inTenant(() =>
        maternityService.recordDelivery(record.id, {
          deliveryType: 'Normal',
          babyCount: 1,
        } as never),
      ),
    ).rejects.toThrow(BadRequestException);
    // deliveryType must be one of the enum values.
    await expect(
      ctx.inTenant(() =>
        maternityService.recordDelivery(record.id, {
          deliveryDate: '2026-02-10',
          deliveryType: 'Home' as never,
          babyCount: 1,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    // babyCount must be >= 1.
    await expect(
      ctx.inTenant(() =>
        maternityService.recordDelivery(record.id, {
          deliveryDate: '2026-02-10',
          deliveryType: 'Normal',
          babyCount: 0,
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    // Unknown record id -> NotFound.
    await expect(
      ctx.inTenant(() =>
        maternityService.recordDelivery('00000000-0000-0000-0000-000000000000', {
          deliveryDate: '2026-02-10',
          deliveryType: 'Normal',
          babyCount: 1,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => maternityService.getRecord('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('fetches a single record and lists records paginated and filterable', async () => {
    const patientA = await makePatient();
    const patientB = await makePatient();
    const admissionA = await makeAdmission(patientA.id);
    const recordA = await ctx.inTenant(() =>
      maternityService.createRecord({ admissionId: admissionA, patientId: patientA.id, gravida: 1 }),
    );

    const firstRecordB = await makeRecord(patientB.id);
    await dischargeAdmission(firstRecordB.admissionId);
    const admissionB2 = await makeAdmission(patientB.id);
    await ctx.inTenant(() =>
      maternityService.createRecord({
        admissionId: admissionB2,
        patientId: patientB.id,
        gravida: 2,
      }),
    );

    const fetched = await ctx.inTenant(() => maternityService.getRecord(recordA.id));
    expect(fetched.id).toBe(recordA.id);
    expect(fetched.gravida).toBe(1);

    const byAdmission = await ctx.inTenant(() =>
      maternityService.listRecords({ admissionId: admissionA }),
    );
    expect(byAdmission.meta.total).toBe(1);
    expect(byAdmission.data[0].id).toBe(recordA.id);

    const byPatient = await ctx.inTenant(() =>
      maternityService.listRecords({ patientId: patientB.id }),
    );
    expect(byPatient.meta.total).toBe(2);
    expect(byPatient.data.every((r) => r.patientId === patientB.id)).toBe(true);

    const page = await ctx.inTenant(() =>
      maternityService.listRecords({ patientId: patientB.id, page: 1, limit: 1 }),
    );
    expect(page.meta.page).toBe(1);
    expect(page.meta.limit).toBe(1);
    expect(page.meta.total).toBe(2);
    expect(page.data).toHaveLength(1);

    const all = await ctx.inTenant(() => maternityService.listRecords({}));
    expect(all.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const patient = await makePatient();
    const record = await makeRecord(patient.id);

    // Tenant B sees none of tenant A's records.
    const tenantBRecords = await tenantB.inTenant(() => maternityService.listRecords({}));
    expect(tenantBRecords.meta.total).toBe(0);

    // Tenant B cannot read or act on tenant A's rows.
    await expect(tenantB.inTenant(() => maternityService.getRecord(record.id))).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      tenantB.inTenant(() =>
        maternityService.recordDelivery(record.id, {
          deliveryDate: '2026-02-10',
          deliveryType: 'Normal',
          babyCount: 1,
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    // Tenant A is untouched by tenant B's activity.
    const records = await ctx.inTenant(() =>
      maternityService.listRecords({ patientId: patient.id }),
    );
    expect(records.meta.total).toBe(1);
  });
});
