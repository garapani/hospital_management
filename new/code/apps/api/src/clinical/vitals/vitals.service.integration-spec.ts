import { NotFoundException } from '@nestjs/common';
import { createDataSource } from '../../database/data-source.js';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { TenantsService } from '../../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { VitalsService } from './vitals.service.js';
import { PatientsService } from '../../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../../patients/patient-number-generator.service.js';
import { AccountsService } from '../../accounts/accounts.service.js';

describe('VitalsService (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let vitalsService: VitalsService;
  let tenantsService: TenantsService;
  let patientsService: PatientsService;
  
  let tenantId1: string;
  let tenantId2: string;

  beforeAll(async () => {
    await dataSource.initialize();
    
    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    tenantsService = new TenantsService(dataSource);
    const patientSequence = new PatientNumberGeneratorService(tenantConnection);
    patientsService = new PatientsService(tenantConnection, patientSequence);
    vitalsService = new VitalsService(tenantConnection);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({
      hospitalId: `vitals_1_${uniqueId}`,
      hospitalName: 'Vitals Hospital 1',
    });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({
      hospitalId: `vitals_2_${uniqueId}`,
      hospitalName: 'Vitals Hospital 2',
    });
    tenantId2 = t2.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId2);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('creates and lists vitals within a tenant boundary', async () => {
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId2, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
      await expect(vitalsService.update('00000000-0000-0000-0000-000000000000', { weight: 70 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('enforces tenant isolation for vitals', async () => {
    let sharedPatientId: string;
    let sharedVitalId: string;

    // Create in tenant 1
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId2, correlationId: 'c1' }, async () => {
      const vitals = await vitalsService.listByPatient(sharedPatientId);
      expect(vitals).toHaveLength(0);

      await expect(vitalsService.update(sharedVitalId, { weight: 75 })).rejects.toThrow(NotFoundException);
    });
  });
});
