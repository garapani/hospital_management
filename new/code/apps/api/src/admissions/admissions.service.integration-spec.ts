import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { TriageService } from '../clinical/triage/triage.service.js';
import { AdmissionsService } from './admissions.service.js';
import { Admission } from './entities/admission.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AdmissionsService (integration)', () => {
  let ctx: TenantTestContext;
  let ctx2: TenantTestContext;
  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let appointmentsService: AppointmentsService;
  let triageService: TriageService;
  let admissionsService: AdmissionsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'admissions_svc' });
    ctx2 = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence);
    masterDataService = new MasterDataService(ctx.tenantConnection, ctx.dataSource);
    appointmentsService = new AppointmentsService(ctx.tenantConnection);
    triageService = new TriageService(ctx.tenantConnection);
    admissionsService = new AdmissionsService(ctx.tenantConnection);
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

  async function makeBed(tenantCtx: TenantTestContext, wardCode: string, bedNumber = '1') {
    const ward = await tenantCtx.inTenant(async () => {
      try {
        return await masterDataService.createWard({ wardCode, wardName: wardCode });
      } catch (error) {
        if (error instanceof ConflictException) {
          const wards = await masterDataService.listWards();
          const existing = wards.find((w) => w.wardCode === wardCode);
          if (existing) {
            return existing;
          }
        }
        throw error;
      }
    });
    return tenantCtx.inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber }));
  }

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000d1';

  it('admits a patient directly and occupies the bed', async () => {
    const patient = await makePatient(ctx, '3330000001');
    const bed = await makeBed(ctx, 'ADT1');

    const admission = await ctx.inTenant(() =>
      admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'Direct',
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      }),
    );

    expect(admission.status).toBe('Admitted');
    expect(admission.wardId).toBe(bed.wardId);
    expect(admission.bedId).toBe(bed.id);

    const occupiedBed = await ctx.inTenant(() => masterDataService.getBed(bed.id));
    expect(occupiedBed?.status).toBe('Occupied');
  });

  it('admits from an appointment source', async () => {
    const patient = await makePatient(ctx, '3330000002');
    const bed = await makeBed(ctx, 'ADT2');
    const appointment = await ctx.inTenant(() =>
      appointmentsService.create({
        patientId: patient.id,
        firstName: 'Test',
        lastName: 'Patient',
        contactNumber: '3330000002',
        appointmentDate: '2026-08-01',
        appointmentTime: '10:00',
        appointmentType: 'OPD',
      }),
    );

    const admission = await ctx.inTenant(() =>
      admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'OPD',
        sourceAppointmentId: appointment.id,
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      }),
    );

    expect(admission.sourceAppointmentId).toBe(appointment.id);
    expect(admission.sourceTriageEntryId).toBeNull();
  });

  it('admits from a linked triage entry', async () => {
    const patient = await makePatient(ctx, '3330000003');
    const bed = await makeBed(ctx, 'ADT3');
    const triageEntry = await ctx.inTenant(() => triageService.create({ chiefComplaint: 'Test' }));
    await ctx.inTenant(() => triageService.linkPatient(triageEntry.id, patient.id));

    const admission = await ctx.inTenant(() =>
      admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'ER',
        sourceTriageEntryId: triageEntry.id,
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      }),
    );

    expect(admission.sourceTriageEntryId).toBe(triageEntry.id);
  });

  it('advances the triage entry status to Admitted and removes it from the active triage board', async () => {
    const patient = await makePatient(ctx, '3330000004');
    const bed = await makeBed(ctx, 'ADT3B');
    const triageEntry = await ctx.inTenant(() => triageService.create({ chiefComplaint: 'Test' }));
    await ctx.inTenant(() => triageService.linkPatient(triageEntry.id, patient.id));

    const activeBefore = await ctx.inTenant(() => triageService.listActive());
    expect(activeBefore.data.some((entry) => entry.id === triageEntry.id)).toBe(true);

    await ctx.inTenant(() =>
      admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'ER',
        sourceTriageEntryId: triageEntry.id,
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      }),
    );

    const updatedEntry = await ctx.inTenant(() => triageService.findOne(triageEntry.id));
    expect(updatedEntry.status).toBe('Admitted');

    const activeAfter = await ctx.inTenant(() => triageService.listActive());
    expect(activeAfter.data.some((entry) => entry.id === triageEntry.id)).toBe(false);
  });

  it('rejects admitting from an unlinked (anonymous) triage entry', async () => {
    const bed = await makeBed(ctx, 'ADT4');
    const anonymousEntry = await ctx.inTenant(() => triageService.create({ firstName: 'Unknown' }));

    await expect(
      ctx.inTenant(() =>
        admissionsService.admit({
          patientId: '00000000-0000-0000-0000-000000000000',
          admissionSource: 'ER',
          sourceTriageEntryId: anonymousEntry.id,
          admittingDoctorId: DOCTOR_ID,
          bedId: bed.id,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects providing both sourceAppointmentId and sourceTriageEntryId', async () => {
    const patient = await makePatient(ctx, '3330000005');
    const bed = await makeBed(ctx, 'ADT5');

    await expect(
      ctx.inTenant(() =>
        admissionsService.admit({
          patientId: patient.id,
          admissionSource: 'ER',
          sourceAppointmentId: '00000000-0000-0000-0000-000000000000',
          sourceTriageEntryId: '00000000-0000-0000-0000-000000000000',
          admittingDoctorId: DOCTOR_ID,
          bedId: bed.id,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects admitting into an already-occupied bed', async () => {
    const bed = await makeBed(ctx, 'ADT6');
    const patientA = await makePatient(ctx, '3330000006');
    const patientB = await makePatient(ctx, '3330000007');

    await ctx.inTenant(() =>
      admissionsService.admit({ patientId: patientA.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
    );

    await expect(
      ctx.inTenant(() =>
        admissionsService.admit({ patientId: patientB.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects admitting an unknown patientId', async () => {
    const bed = await makeBed(ctx, 'ADT6B');

    await expect(
      ctx.inTenant(() =>
        admissionsService.admit({
          patientId: '00000000-0000-0000-0000-000000000000',
          admissionSource: 'Direct',
          admittingDoctorId: DOCTOR_ID,
          bedId: bed.id,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('maps a bed double-booking race at the DB constraint level to ConflictException', async () => {
    // Simulates the losing side of a race between two concurrent admit() calls that
    // both pass the synchronous `bed.status !== 'Available'` check before either
    // commits its Admission insert. Rather than relying on true concurrency (flaky
    // in this environment), we force the same failure deterministically: insert an
    // 'Admitted' row for this bed directly via the repository, bypassing admit()'s
    // own bed-status check entirely, so the Bed row is left 'Available' while an
    // active Admission for it already exists. A subsequent admit() call for the
    // same bed then passes the bed-status check (bed is still 'Available') and only
    // fails when its own Admission insert hits the partial unique index
    // (UQ_admissions_active_bed on (bedId) WHERE status = 'Admitted') — exactly the
    // path the real race would take. This must surface as ConflictException, not a
    // raw QueryFailedError.
    const patient = await makePatient(ctx, '3330000016');
    const bed = await makeBed(ctx, 'ADTRACE');

    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        const repository = manager.getRepository(Admission);
        await repository.save(
          repository.create({
            patientId: patient.id,
            admissionSource: 'Direct',
            admittingDoctorId: DOCTOR_ID,
            wardId: bed.wardId,
            bedId: bed.id,
            status: 'Admitted',
          }),
        );
      }),
    );

    await expect(
      ctx.inTenant(() =>
        admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('transfers a patient to a new bed, freeing the old one and occupying the new one', async () => {
    const patient = await makePatient(ctx, '3330000008');
    const bedA = await makeBed(ctx, 'ADT7', 'A');
    const bedB = await makeBed(ctx, 'ADT7', 'B');

    const admission = await ctx.inTenant(() =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );

    const transferred = await ctx.inTenant(() =>
      admissionsService.transfer(admission.id, { toBedId: bedB.id, transferredBy: DOCTOR_ID, reason: 'ICU step-down' }),
    );

    expect(transferred.bedId).toBe(bedB.id);
    expect(transferred.wardId).toBe(bedB.wardId);

    const freedBed = await ctx.inTenant(() => masterDataService.getBed(bedA.id));
    expect(freedBed?.status).toBe('Available');
    const occupiedBed = await ctx.inTenant(() => masterDataService.getBed(bedB.id));
    expect(occupiedBed?.status).toBe('Occupied');
  });

  it('rejects transferring into a non-available bed', async () => {
    const patientA = await makePatient(ctx, '3330000009');
    const patientB = await makePatient(ctx, '3330000010');
    const bedA = await makeBed(ctx, 'ADT8', 'A');
    const bedB = await makeBed(ctx, 'ADT8', 'B');

    const admissionA = await ctx.inTenant(() =>
      admissionsService.admit({ patientId: patientA.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );
    await ctx.inTenant(() =>
      admissionsService.admit({ patientId: patientB.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedB.id }),
    );

    await expect(
      ctx.inTenant(() => admissionsService.transfer(admissionA.id, { toBedId: bedB.id, transferredBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
  });

  it('discharges a patient, freeing the bed', async () => {
    const patient = await makePatient(ctx, '3330000011');
    const bed = await makeBed(ctx, 'ADT9');

    const admission = await ctx.inTenant(() =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
    );

    const discharged = await ctx.inTenant(() =>
      admissionsService.discharge(admission.id, { dischargedBy: DOCTOR_ID, dischargeType: 'Routine', dischargeCondition: 'Improved' }),
    );

    expect(discharged.status).toBe('Discharged');
    expect(discharged.dischargeDate).not.toBeNull();

    const freedBed = await ctx.inTenant(() => masterDataService.getBed(bed.id));
    expect(freedBed?.status).toBe('Available');
  });

  it('rejects transfer and discharge on an already-discharged admission', async () => {
    const patient = await makePatient(ctx, '3330000012');
    const bedA = await makeBed(ctx, 'ADT10', 'A');
    const bedB = await makeBed(ctx, 'ADT10', 'B');

    const admission = await ctx.inTenant(() =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );
    await ctx.inTenant(() => admissionsService.discharge(admission.id, { dischargedBy: DOCTOR_ID }));

    await expect(
      ctx.inTenant(() => admissionsService.transfer(admission.id, { toBedId: bedB.id, transferredBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => admissionsService.discharge(admission.id, { dischargedBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
  });

  it('lists active admissions, optionally filtered by ward, excluding discharged ones', async () => {
    const patientA = await makePatient(ctx2, '3330000013');
    const patientB = await makePatient(ctx2, '3330000014');
    const bedA = await makeBed(ctx2, 'ADTLIST_A');
    const bedB = await makeBed(ctx2, 'ADTLIST_B');

    const admissionA = await ctx2.inTenant(() =>
      admissionsService.admit({ patientId: patientA.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );
    const admissionB = await ctx2.inTenant(() =>
      admissionsService.admit({ patientId: patientB.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedB.id }),
    );
    await ctx2.inTenant(() => admissionsService.discharge(admissionB.id, { dischargedBy: DOCTOR_ID }));

    const all = await ctx2.inTenant(() => admissionsService.listActive());
    expect(all.some((a) => a.id === admissionA.id)).toBe(true);
    expect(all.some((a) => a.id === admissionB.id)).toBe(false);

    const filtered = await ctx2.inTenant(() => admissionsService.listActive(admissionA.wardId));
    expect(filtered.some((a) => a.id === admissionA.id)).toBe(true);
  });

  it('throws NotFoundException for an unknown admission id', async () => {
    await expect(
      ctx.inTenant(() => admissionsService.findOne('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces tenant isolation for admissions', async () => {
    const patient = await makePatient(ctx, '3330000015');
    const bed = await makeBed(ctx, 'ADTISO');

    const admission = await ctx.inTenant(() =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
    );

    await expect(
      ctx2.inTenant(() => admissionsService.findOne(admission.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
