import { NotFoundException } from '@nestjs/common';
import { TriageService } from './triage.service.js';
import { PatientsService } from '../../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../../patients/patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../../testing/tenant-test-context.js';

describe('TriageService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let triageService: TriageService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'triage_svc' });
    tenantB = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence);
    triageService = new TriageService(ctx.tenantConnection);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
  });

  it('registers an ER arrival for a known patient', async () => {
    await ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1980-01-01',
        gender: 'Male',
        phoneNumber: '1111111111',
      });

      const entry = await triageService.create({
        patientId: patient.id,
        arrivalMode: 'Walk-in',
        chiefComplaint: 'Chest pain',
      });

      expect(entry.id).toBeDefined();
      expect(entry.status).toBe('Arrived');
      expect(entry.isPoliceCase).toBe(false);
      expect(entry.patientId).toBe(patient.id);
    });
  });

  it('registers an anonymous ER arrival with temporary demographics', async () => {
    await ctx.inTenant(async () => {
      const entry = await triageService.create({
        firstName: 'Unknown',
        lastName: 'Male',
        gender: 'Male',
        estimatedAge: '~40',
        arrivalMode: 'Ambulance',
        isPoliceCase: true,
        chiefComplaint: 'Found unconscious',
      });

      expect(entry.patientId).toBeNull();
      expect(entry.isPoliceCase).toBe(true);
      expect(entry.status).toBe('Arrived');
    });
  });

  it('assigns acuity and updates status via update()', async () => {
    await tenantB.inTenant(async () => {
      const entry = await triageService.create({ chiefComplaint: 'Fever' });

      const triagedAt = new Date();
      const updated = await triageService.update(entry.id, {
        acuityLevel: 3,
        colorCode: 'Yellow',
        triagedBy: '00000000-0000-0000-0000-000000000099',
        triagedAt,
        status: 'Triaged',
      });

      expect(updated.acuityLevel).toBe(3);
      expect(updated.colorCode).toBe('Yellow');
      expect(updated.status).toBe('Triaged');
    });
  });

  it('links an anonymous entry to a newly registered patient', async () => {
    await tenantB.inTenant(async () => {
      const entry = await triageService.create({ firstName: 'Jane', lastName: 'Roe' });
      expect(entry.patientId).toBeNull();

      const patient = await patientsService.create({
        firstName: 'Jane',
        lastName: 'Roe',
        dateOfBirth: '1975-05-05',
        gender: 'Female',
        phoneNumber: '2222222222',
      });

      const linked = await triageService.linkPatient(entry.id, patient.id);
      expect(linked.patientId).toBe(patient.id);
    });
  });

  it('lists active entries ordered by acuity then triagedAt, excluding closed entries', async () => {
    await ctx.inTenant(async () => {
      const low = await triageService.create({ chiefComplaint: 'Low priority' });
      const high = await triageService.create({ chiefComplaint: 'High priority' });
      const closed = await triageService.create({ chiefComplaint: 'Already handled' });

      await triageService.update(low.id, { acuityLevel: 4, status: 'Triaged' });
      await triageService.update(high.id, { acuityLevel: 1, status: 'Triaged' });
      await triageService.update(closed.id, { acuityLevel: 2, status: 'Discharged' });

      const active = await triageService.listActive();
      const ids = active.map((e) => e.id);

      expect(ids).not.toContain(closed.id);
      expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id));
    });
  });

  it('throws NotFoundException when updating a non-existent entry', async () => {
    await ctx.inTenant(async () => {
      await expect(
        triageService.update('00000000-0000-0000-0000-000000000000', { status: 'Triaged' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('enforces tenant isolation for triage entries', async () => {
    let sharedEntryId: string;

    await ctx.inTenant(async () => {
      const entry = await triageService.create({ chiefComplaint: 'Isolated case' });
      sharedEntryId = entry.id;
    });

    await tenantB.inTenant(async () => {
      await expect(triageService.findOne(sharedEntryId)).rejects.toThrow(NotFoundException);
    });
  });
});
