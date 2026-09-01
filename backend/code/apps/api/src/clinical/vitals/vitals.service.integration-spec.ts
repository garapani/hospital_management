import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
    vitalsService = new VitalsService(ctx.tenantConnection, ctx.tenantContext);
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

  it('leaves BMI unset rather than overflowing its decimal(5,2) column on an extreme height/weight combo', async () => {
    await ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Extreme', lastName: 'Combo', gender: 'Male', phoneNumber: '1234500001',
      });

      // Both individually within CreateVitalDto's range, but height=30cm/weight=500kg computes
      // to a BMI (~5555) far past decimal(5,2)'s 999.99 ceiling.
      const vital = await vitalsService.create({ patientId: patient.id, height: 30, weight: 500 });
      expect(vital.bmi).toBeFalsy();
    });
  });

  it('nulls a stale BMI when height/weight no longer both resolve to a valid combination', async () => {
    await ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Stale', lastName: 'Bmi', gender: 'Female', phoneNumber: '1234500002',
      });

      const created = await vitalsService.create({ patientId: patient.id, height: 160, weight: 60 });
      expect(created.bmi).toBe(23.44);

      // height=0 fails calculateBmi's own truthiness check (falls back to "no BMI"), simulating
      // the same "no longer computable" case a real height clear would hit.
      const updated = await vitalsService.update(created.id, { height: 0 });
      expect(updated.bmi).toBeFalsy();
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

  describe('ward-scoped access', () => {
    const WARD_A = '00000000-0000-4000-8000-0000000000d1';
    const WARD_B = '00000000-0000-4000-8000-0000000000d2';

    /** Simulates a ward-assigned staff member's request context (the JWT's wardId claim,
     *  see auth-context.middleware.ts). Bypasses ctx.inTenant() (which never sets wardId). */
    function withWard<T>(wardId: string, work: () => Promise<T>): Promise<T> {
      return ctx.tenantContext.run({ tenantId: ctx.tenantId, wardId, correlationId: 'vitals-ward-test' }, work);
    }

    async function admitPatient(patientId: string, wardId: string): Promise<void> {
      await ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO admissions ("patientId", "admissionSource", "admittingDoctorId", "wardId", "bedId", status)
           VALUES ($1, $2, $3, $4, $5, 'Admitted')`,
          [
            patientId,
            'OPD',
            '00000000-0000-4000-8000-0000000000e1',
            wardId,
            `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`,
          ],
        ),
      );
    }

    it('lets a ward-assigned nurse record vitals for a patient admitted to her own ward', async () => {
      await ctx.inTenant(async () => {
        const patient = await patientsService.create({
          firstName: 'Ward', lastName: 'Match', gender: 'Male', phoneNumber: '2220000001',
        });
        await admitPatient(patient.id, WARD_A);

        const vital = await withWard(WARD_A, () =>
          vitalsService.create({ patientId: patient.id, pulse: 72 }),
        );
        expect(vital.id).toBeDefined();

        const list = await withWard(WARD_A, () => vitalsService.listByPatient(patient.id));
        expect(list).toHaveLength(1);

        const updated = await withWard(WARD_A, () => vitalsService.update(vital.id, { pulse: 80 }));
        expect(updated.pulse).toBe(80);
      });
    });

    it("denies a ward-assigned nurse recording vitals for a patient admitted to a different ward", async () => {
      await ctx.inTenant(async () => {
        const patient = await patientsService.create({
          firstName: 'Ward', lastName: 'Mismatch', gender: 'Female', phoneNumber: '2220000002',
        });
        await admitPatient(patient.id, WARD_B);

        await expect(
          withWard(WARD_A, () => vitalsService.create({ patientId: patient.id, pulse: 72 })),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          withWard(WARD_A, () => vitalsService.listByPatient(patient.id)),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    it('denies a ward-assigned nurse recording vitals for a patient with no active admission at all', async () => {
      await ctx.inTenant(async () => {
        const patient = await patientsService.create({
          firstName: 'Never', lastName: 'Admitted', gender: 'Male', phoneNumber: '2220000003',
        });

        await expect(
          withWard(WARD_A, () => vitalsService.create({ patientId: patient.id, pulse: 72 })),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    it('leaves an unassigned staff member (no wardId) with unrestricted tenant-wide access', async () => {
      await ctx.inTenant(async () => {
        const patient = await patientsService.create({
          firstName: 'No', lastName: 'WardStaff', gender: 'Female', phoneNumber: '2220000004',
        });
        await admitPatient(patient.id, WARD_B);

        const vital = await vitalsService.create({ patientId: patient.id, pulse: 72 });
        expect(vital.id).toBeDefined();
      });
    });
  });
});
