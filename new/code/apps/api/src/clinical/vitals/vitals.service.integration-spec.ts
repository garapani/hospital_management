import { NotFoundException } from '@nestjs/common';
import { VitalsService } from './vitals.service.js';
import { PatientsService } from '../../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../../patients/patient-number-generator.service.js';
import { AccountsService } from '../../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../../testing/tenant-test-context.js';

describe('VitalsService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let vitalsService: VitalsService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'vitals_svc' });
    tenantB = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence, new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
    vitalsService = new VitalsService(ctx.tenantConnection);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
  });

  it('creates and lists vitals within a tenant boundary', async () => {
    await ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1980-01-01',
        gender: 'Male',
        phoneNumber: '1234567890',
        governmentIdNumber: 'ID123',
      });

      const vital = await vitalsService.create({
        patientId: patient.id,
        height: 180,
        weight: 75,
        temperature: 37.2,
        pulse: 72,
        bpSystolic: 120,
        bpDiastolic: 80,
        respiratoryRate: 16,
        spO2: 98,
        triageNotes: 'Patient looks healthy',
      });

      expect(vital.id).toBeDefined();
      expect(vital.bmi).toBe(23.15); // 75 / (1.8 * 1.8) = 23.148... -> 23.15

      const patientVitals = await vitalsService.listByPatient(patient.id);
      expect(patientVitals).toHaveLength(1);
      expect(patientVitals[0].id).toBe(vital.id);
    });
  });

  it('calculates BMI correctly on update', async () => {
    await ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1990-01-01',
        gender: 'Female',
        phoneNumber: '1234567891',
      });

      let vital = await vitalsService.create({
        patientId: patient.id,
        height: 160,
        weight: 60,
      });

      expect(vital.bmi).toBe(23.44); // 60 / (1.6 * 1.6) = 23.4375

      vital = await vitalsService.update(vital.id, { weight: 65 });
      expect(vital.bmi).toBe(25.39); // 65 / (1.6 * 1.6) = 25.390625
    });
  });

  it('voids vitals correctly', async () => {
    await tenantB.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Bob',
        lastName: 'Smith',
        dateOfBirth: '2000-01-01',
        gender: 'Male',
        phoneNumber: '0987654321',
      });

      const vital = await vitalsService.create({
        patientId: patient.id,
        pulse: 80,
      });

      let patientVitals = await vitalsService.listByPatient(patient.id);
      expect(patientVitals).toHaveLength(1);

      await vitalsService.void(vital.id);

      patientVitals = await vitalsService.listByPatient(patient.id);
      expect(patientVitals).toHaveLength(0);
    });
  });

  it('throws NotFoundException when updating non-existent vital', async () => {
    await ctx.inTenant(async () => {
      await expect(vitalsService.update('00000000-0000-0000-0000-000000000000', { weight: 70 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('enforces tenant isolation for vitals', async () => {
    let sharedPatientId: string;
    let sharedVitalId: string;

    // Create in tenant 1
    await ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Isolated',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '000',
      });
      sharedPatientId = patient.id;

      const vital = await vitalsService.create({
        patientId: patient.id,
        height: 170,
        weight: 70,
      });
      sharedVitalId = vital.id;
    });

    // Verify not visible in tenant 2
    await tenantB.inTenant(async () => {
      const vitals = await vitalsService.listByPatient(sharedPatientId);
      expect(vitals).toHaveLength(0);

      await expect(vitalsService.update(sharedVitalId, { weight: 75 })).rejects.toThrow(NotFoundException);
    });
  });
});
