import { NotFoundException } from '@nestjs/common';
import { createDataSource } from '../../database/data-source.js';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { TenantsService } from '../../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { TriageService } from './triage.service.js';
import { PatientsService } from '../../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../../patients/patient-number-generator.service.js';
import { AccountsService } from '../../accounts/accounts.service.js';

describe('TriageService (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let triageService: TriageService;
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
    triageService = new TriageService(tenantConnection);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({
      hospitalId: `triage_1_${uniqueId}`,
      hospitalName: 'Triage Hospital 1',
    });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({
      hospitalId: `triage_2_${uniqueId}`,
      hospitalName: 'Triage Hospital 2',
    });
    tenantId2 = t2.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId2);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('registers an ER arrival for a known patient', async () => {
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId2, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId2, correlationId: 'c1' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c2' }, async () => {
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
    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
      await expect(
        triageService.update('00000000-0000-0000-0000-000000000000', { status: 'Triaged' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('enforces tenant isolation for triage entries', async () => {
    let sharedEntryId: string;

    await tenantContextService.run({ tenantId: tenantId1, correlationId: 'c1' }, async () => {
      const entry = await triageService.create({ chiefComplaint: 'Isolated case' });
      sharedEntryId = entry.id;
    });

    await tenantContextService.run({ tenantId: tenantId2, correlationId: 'c1' }, async () => {
      await expect(triageService.findOne(sharedEntryId)).rejects.toThrow(NotFoundException);
    });
  });
});
