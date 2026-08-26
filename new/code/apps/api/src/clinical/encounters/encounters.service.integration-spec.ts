import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EncountersService } from './encounters.service.js';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Patient } from '../../patients/entities/patient.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../../testing/tenant-test-context.js';

describe('EncountersService (integration)', () => {
  let service: EncountersService;
  let ctx: TenantTestContext;
  let patientId: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'encounters_svc' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncountersService,
        {
          provide: TenantConnectionService,
          useValue: {
            runInTenantSchema: async (cb: any) => {
              return ctx.dataSource.transaction(async (manager) => {
                await manager.query(`SET search_path TO "tenant_${ctx.tenantId}", public`);
                return cb(manager);
              });
            },
          },
        },
        { provide: TenantContextService, useValue: ctx.tenantContext },
      ],
    }).compile();

    service = module.get<EncountersService>(EncountersService);

    const patient = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Patient).save(
          manager.getRepository(Patient).create({
            patientNo: `ENC-SVC-${Date.now()}`,
            firstName: 'Fixture',
            lastName: 'Patient',
            gender: 'Female',
          }),
        ),
      ),
    );
    patientId = patient.id;
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
  });

  it('creates, retrieves and updates clinical notes', async () => {
    const note = await service.createNote({
      patientId,
      doctorId: '00000000-0000-0000-0000-000000000002',
      chiefComplaint: 'Headache',
    });
    expect(note.id).toBeDefined();
    expect(note.status).toBe('Draft');

    const notes = await service.getNotesByPatient(patientId);
    expect(notes.data.length).toBe(1);
    expect(notes.data[0].chiefComplaint).toBe('Headache');

    const updated = await service.updateNote(note.id, { plan: 'Rest', status: 'Signed' });
    expect(updated.plan).toBe('Rest');
    expect(updated.status).toBe('Signed');

    await expect(service.updateNote(note.id, { plan: 'Too late' })).rejects.toThrow(ConflictException);
  });

  it('creates, retrieves and deletes diagnoses', async () => {
    const dx = await service.createDiagnosis({
      patientId,
      doctorId: '00000000-0000-0000-0000-000000000002',
      description: 'Migraine',
      isPrimary: true,
    });
    expect(dx.id).toBeDefined();
    expect(dx.description).toBe('Migraine');

    const diagnoses = await service.getDiagnosesByPatient(patientId);
    expect(diagnoses.data.length).toBe(1);

    await service.deleteDiagnosis(dx.id);
    const afterDelete = await service.getDiagnosesByPatient(patientId);
    expect(afterDelete.data.length).toBe(0);
  });

  it('creates, retrieves and deletes prescriptions', async () => {
    const rx = await service.createPrescription({
      patientId,
      doctorId: '00000000-0000-0000-0000-000000000002',
      medicationName: 'Ibuprofen',
      dosage: '400mg',
      frequency: 'TID',
      route: 'Oral',
      durationDays: 3,
    });
    expect(rx.id).toBeDefined();

    const scripts = await service.getPrescriptionsByPatient(patientId);
    expect(scripts.data.length).toBe(1);

    await service.deletePrescription(rx.id);
    const afterDelete = await service.getPrescriptionsByPatient(patientId);
    expect(afterDelete.data.length).toBe(0);
  });

  it('rejects creating a note, diagnosis, or prescription for a nonexistent patient', async () => {
    const fakePatientId = '11111111-1111-1111-1111-111111111111';
    await expect(
      service.createNote({ patientId: fakePatientId, doctorId: '00000000-0000-0000-0000-000000000002', chiefComplaint: 'x' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.createDiagnosis({ patientId: fakePatientId, doctorId: '00000000-0000-0000-0000-000000000002', description: 'x', isPrimary: false }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.createPrescription({
        patientId: fakePatientId,
        doctorId: '00000000-0000-0000-0000-000000000002',
        medicationName: 'x',
        dosage: 'x',
        frequency: 'x',
        route: 'x',
        durationDays: 1,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('discontinues and completes a prescription, and rejects transitioning it twice', async () => {
    const rx = await service.createPrescription({
      patientId,
      doctorId: '00000000-0000-0000-0000-000000000002',
      medicationName: 'Amoxicillin',
      dosage: '500mg',
      frequency: 'TID',
      route: 'Oral',
      durationDays: 7,
    });

    const discontinued = await service.discontinuePrescription(rx.id);
    expect(discontinued.status).toBe('Discontinued');

    await expect(service.discontinuePrescription(rx.id)).rejects.toThrow(ConflictException);
    await expect(service.completePrescription(rx.id)).rejects.toThrow(ConflictException);

    const rx2 = await service.createPrescription({
      patientId,
      doctorId: '00000000-0000-0000-0000-000000000002',
      medicationName: 'Azithromycin',
      dosage: '250mg',
      frequency: 'OD',
      route: 'Oral',
      durationDays: 5,
    });
    const completed = await service.completePrescription(rx2.id);
    expect(completed.status).toBe('Completed');
  });

  describe('doctorId derives from the authenticated principal, never the caller-supplied value', () => {
    const AUTHENTICATED_ACCOUNT_ID = '00000000-0000-0000-0000-0000000000a1';
    const SPOOFED_DOCTOR_ID = '00000000-0000-0000-0000-0000000000ee';

    const asAuthenticatedRequest = <T>(work: () => Promise<T>): Promise<T> =>
      ctx.tenantContext.run({ tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT_ID, correlationId: 'test' }, work);

    it('createNote ignores a caller-supplied doctorId in favor of the authenticated account', async () => {
      const note = await asAuthenticatedRequest(() =>
        service.createNote({
          patientId,
          doctorId: SPOOFED_DOCTOR_ID,
          chiefComplaint: 'Spoof attempt',
        }),
      );
      expect(note.doctorId).toBe(AUTHENTICATED_ACCOUNT_ID);
      expect(note.doctorId).not.toBe(SPOOFED_DOCTOR_ID);
    });

    it('createDiagnosis ignores a caller-supplied doctorId in favor of the authenticated account', async () => {
      const dx = await asAuthenticatedRequest(() =>
        service.createDiagnosis({
          patientId,
          doctorId: SPOOFED_DOCTOR_ID,
          description: 'Spoof attempt',
          isPrimary: false,
        }),
      );
      expect(dx.doctorId).toBe(AUTHENTICATED_ACCOUNT_ID);
    });

    it('createPrescription ignores a caller-supplied doctorId in favor of the authenticated account', async () => {
      const rx = await asAuthenticatedRequest(() =>
        service.createPrescription({
          patientId,
          doctorId: SPOOFED_DOCTOR_ID,
          medicationName: 'Ibuprofen',
          dosage: '400mg',
          frequency: 'TID',
          route: 'Oral',
          durationDays: 3,
        }),
      );
      expect(rx.doctorId).toBe(AUTHENTICATED_ACCOUNT_ID);
    });
  });
});
