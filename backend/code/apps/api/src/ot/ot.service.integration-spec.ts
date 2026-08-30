import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OtService } from './ot.service.js';
import { OtSurgeryNumberGeneratorService } from './ot-surgery-number-generator.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('OtService (integration)', () => {
  let ctx: TenantTestContext;
  let otService: OtService;
  let patientsService: PatientsService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'ot' });
    otService = new OtService(
      ctx.tenantConnection,
      new OtSurgeryNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
    );
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'ot-test' },
      work,
    );
  }

  let seq = 0;
  async function makePatient() {
    seq += 1;
    return ctx.inTenant(() =>
      patientsService.create({
        firstName: 'OT',
        lastName: `Patient${seq}`,
        dateOfBirth: '1980-01-15',
        gender: 'Male',
        phoneNumber: `5590000${String(seq).padStart(3, '0')}`,
      }),
    );
  }

  async function makeAdmission(patientId: string) {
    return ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        const result = await manager.query(
          `INSERT INTO admissions ("patientId", "admissionSource", "admittingDoctorId", "wardId", "bedId")
           VALUES ($1, 'OPD', $2, $3, $4) RETURNING id`,
          [patientId, STAFF_ID, STAFF_ID, STAFF_ID],
        );
        return result[0].id as string;
      }),
    );
  }

  async function schedule(
    patientId: string,
    overrides: Partial<Parameters<OtService['scheduleSurgery']>[0]> = {},
  ) {
    seq += 1;
    return ctx.inTenant(() =>
      otService.scheduleSurgery({
        patientId,
        procedureName: `Appendectomy ${seq}`,
        scheduledBy: STAFF_ID,
        ...overrides,
      }),
    );
  }

  it('schedules a surgery, generating a SUR-numbered record', async () => {
    const patient = await makePatient();
    const surgery = await schedule(patient.id, {
      procedureName: 'Laparoscopic Cholecystectomy',
      otRoom: 'OT-1',
      surgeonId: STAFF_ID,
      notes: 'Day case',
    });

    expect(surgery.surgeryNumber).toMatch(/^SUR-\d{4}-\d+$/);
    expect(surgery.patientId).toBe(patient.id);
    expect(surgery.admissionId).toBeNull();
    expect(surgery.procedureName).toBe('Laparoscopic Cholecystectomy');
    expect(surgery.otRoom).toBe('OT-1');
    expect(surgery.surgeonId).toBe(STAFF_ID);
    expect(surgery.status).toBe('Scheduled');
    expect(surgery.startedAt).toBeNull();
    expect(surgery.endedAt).toBeNull();
    // No tenant account context -> the §25 fallback is used.
    expect(surgery.scheduledBy).toBe(STAFF_ID);

    const second = await schedule(patient.id);
    expect(second.surgeryNumber).not.toBe(surgery.surgeryNumber);
  });

  it('validates procedureName, scheduledAt, and patient/admission references', async () => {
    const patient = await makePatient();

    await expect(
      ctx.inTenant(() => otService.scheduleSurgery({ patientId: patient.id, procedureName: '   ' })),
    ).rejects.toThrow(BadRequestException);

    await expect(
      ctx.inTenant(() =>
        otService.scheduleSurgery({ patientId: patient.id, procedureName: 'X', scheduledAt: 'not-a-date' }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      ctx.inTenant(() =>
        otService.scheduleSurgery({
          patientId: '00000000-0000-0000-0000-000000000000',
          procedureName: 'X',
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    const admissionId = await makeAdmission(patient.id);
    const withAdmission = await schedule(patient.id, { admissionId });
    expect(withAdmission.admissionId).toBe(admissionId);

    await expect(
      ctx.inTenant(() =>
        otService.scheduleSurgery({
          patientId: patient.id,
          procedureName: 'X',
          admissionId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    const otherPatient = await makePatient();
    await expect(
      ctx.inTenant(() =>
        otService.scheduleSurgery({
          patientId: otherPatient.id,
          procedureName: 'X',
          admissionId,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('runs the lifecycle schedule -> start -> complete, recording each transition actor', async () => {
    const patient = await makePatient();
    const surgery = await schedule(patient.id);
    expect(surgery.status).toBe('Scheduled');

    const started = await withActor(() => otService.startSurgery(surgery.id));
    expect(started.status).toBe('InProgress');
    expect(started.startedAt).not.toBeNull();
    expect(started.startedBy).toBe(AUTHENTICATED_ACCOUNT);

    const completed = await withActor(() =>
      otService.completeSurgery(surgery.id, undefined, 'Uneventful recovery'),
    );
    expect(completed.status).toBe('Completed');
    expect(completed.endedAt).not.toBeNull();
    expect(completed.completedBy).toBe(AUTHENTICATED_ACCOUNT);
    expect(completed.postOpNotes).toBe('Uneventful recovery');
  });

  it('records the cancelling actor and reason', async () => {
    const patient = await makePatient();
    const surgery = await schedule(patient.id);

    const cancelled = await withActor(() =>
      otService.cancelSurgery(surgery.id, undefined, 'Patient rescheduled'),
    );
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.cancelledBy).toBe(AUTHENTICATED_ACCOUNT);
    expect(cancelled.cancellationReason).toBe('Patient rescheduled');
  });

  it('rejects scheduling two surgeries into the same room at the same instant', async () => {
    const patient = await makePatient();
    const scheduledAt = '2026-09-01T09:00:00.000Z';
    await schedule(patient.id, { otRoom: 'OT-2', scheduledAt });

    await expect(
      ctx.inTenant(() =>
        otService.scheduleSurgery({
          patientId: patient.id,
          procedureName: 'Conflicting Procedure',
          otRoom: 'OT-2',
          scheduledAt,
        }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects starting a second surgery in a room that already has one in progress', async () => {
    const patient = await makePatient();
    const first = await schedule(patient.id, { otRoom: 'OT-3', scheduledAt: '2026-09-02T09:00:00.000Z' });
    const second = await schedule(patient.id, { otRoom: 'OT-3', scheduledAt: '2026-09-02T14:00:00.000Z' });

    await ctx.inTenant(() => otService.startSurgery(first.id));
    await expect(ctx.inTenant(() => otService.startSurgery(second.id))).rejects.toThrow(
      ConflictException,
    );
  });

  it('enforces the status machine with conflicts', async () => {
    const patient = await makePatient();
    const surgery = await schedule(patient.id);

    // Cannot complete a Scheduled surgery (complete requires InProgress).
    await expect(ctx.inTenant(() => otService.completeSurgery(surgery.id))).rejects.toThrow(
      ConflictException,
    );

    await ctx.inTenant(() => otService.startSurgery(surgery.id));
    await expect(ctx.inTenant(() => otService.startSurgery(surgery.id))).rejects.toThrow(
      ConflictException,
    );
    // Cannot cancel a surgery already in progress.
    await expect(ctx.inTenant(() => otService.cancelSurgery(surgery.id))).rejects.toThrow(
      ConflictException,
    );

    await ctx.inTenant(() => otService.completeSurgery(surgery.id));
    await expect(ctx.inTenant(() => otService.completeSurgery(surgery.id))).rejects.toThrow(
      ConflictException,
    );
    await expect(ctx.inTenant(() => otService.cancelSurgery(surgery.id))).rejects.toThrow(
      ConflictException,
    );

    // Cancelling from Scheduled is valid.
    const another = await schedule(patient.id);
    const cancelled = await ctx.inTenant(() => otService.cancelSurgery(another.id));
    expect(cancelled.status).toBe('Cancelled');
    await expect(ctx.inTenant(() => otService.startSurgery(another.id))).rejects.toThrow(
      ConflictException,
    );

    await expect(
      ctx.inTenant(() => otService.startSurgery('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('derives scheduledBy from the authenticated principal (§25)', async () => {
    const patient = await makePatient();
    const surgery = await withActor(() =>
      otService.scheduleSurgery({
        patientId: patient.id,
        procedureName: 'ACL Reconstruction',
        scheduledBy: '00000000-0000-4000-8000-0000000000ff', // spoofed fallback must be ignored
      }),
    );
    expect(surgery.scheduledBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('lists surgeries paginated and filterable by status and patient', async () => {
    const patient = await makePatient();
    await schedule(patient.id);
    await schedule(patient.id);
    const completed = await schedule(patient.id);
    await ctx.inTenant(() => otService.startSurgery(completed.id));
    await ctx.inTenant(() => otService.completeSurgery(completed.id));

    const all = await ctx.inTenant(() => otService.listSurgeries({}));
    expect(all.meta.total).toBeGreaterThanOrEqual(3);
    expect(all.data.length).toBeGreaterThanOrEqual(1);

    const byPatient = await ctx.inTenant(() => otService.listSurgeries({ patientId: patient.id }));
    expect(byPatient.meta.total).toBeGreaterThanOrEqual(3);

    const completedList = await ctx.inTenant(() => otService.listSurgeries({ status: 'Completed' }));
    expect(completedList.data.length).toBeGreaterThanOrEqual(1);
    expect(completedList.data.every((s) => s.status === 'Completed')).toBe(true);

    const fetched = await ctx.inTenant(() => otService.getSurgery(completed.id));
    expect(fetched.id).toBe(completed.id);
    expect(fetched.status).toBe('Completed');
  });

  it('enforces tenant isolation for surgeries', async () => {
    const tenantB = await ctx.createTenant();
    const patient = await makePatient();
    const surgery = await schedule(patient.id);

    await expect(tenantB.inTenant(() => otService.getSurgery(surgery.id))).rejects.toThrow(
      NotFoundException,
    );
  });
});
