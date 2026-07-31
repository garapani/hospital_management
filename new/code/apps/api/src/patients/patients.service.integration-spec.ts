import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '@hospital/tenant-context';
import { dataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreatePatientTables005 } from '../database/migrations/005_create_patient_tables.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { PatientsService } from './patients.service.js';

describe('PatientsService (integration)', () => {
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let generatorService: PatientNumberGeneratorService;
  let service: PatientsService;
  const schema = 'tenant_patients_service_test';

  beforeAll(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    generatorService = new PatientNumberGeneratorService(tenantConnection);
    service = new PatientsService(tenantConnection, generatorService);

    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${schema}"`);

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.query(`SET search_path TO "${schema}"`);
    await new CreatePatientTables005().up(queryRunner);
    await queryRunner.release();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  it('registers patient and triggers conflict exception on duplicate phone without override', async () => {
    await tenantContext.run({ tenantId: 'patients_service_test', correlationId: 'c1' }, async () => {
      const p1 = await service.create({
        firstName: 'Alice',
        lastName: 'Smith',
        gender: 'Female',
        phoneNumber: '9998887770',
      });
      expect(p1.patientNo).toBeDefined();

      await expect(
        service.create({
          firstName: 'Alice',
          lastName: 'Smith',
          gender: 'Female',
          phoneNumber: '9998887770',
          allowDuplicate: false,
        }),
      ).rejects.toThrow(ConflictException);

      const p2 = await service.create({
        firstName: 'Alice',
        lastName: 'Smith',
        gender: 'Female',
        phoneNumber: '9998887770',
        allowDuplicate: true,
      });
      expect(p2.patientNo).not.toEqual(p1.patientNo);
    });
  });

  it('searches and updates patient record', async () => {
    await tenantContext.run({ tenantId: 'patients_service_test', correlationId: 'c2' }, async () => {
      const created = await service.create({
        firstName: 'Robert',
        lastName: 'Brown',
        gender: 'Male',
        phoneNumber: '9123456789',
      });

      const found = await service.findAll({ q: 'Robert' });
      expect(found.data).toHaveLength(1);
      expect(found.data[0].id).toBe(created.id);

      const updated = await service.update(created.id, { email: 'robert.b@example.com' });
      expect(updated.email).toBe('robert.b@example.com');
    });
  });

  it('finds patient by id and handles not found and deactivation', async () => {
    await tenantContext.run({ tenantId: 'patients_service_test', correlationId: 'c3' }, async () => {
      const created = await service.create({
        firstName: 'Jane',
        lastName: 'Doe',
        gender: 'Female',
        phoneNumber: '9876543210',
      });

      const fetched = await service.findOne(created.id);
      expect(fetched.id).toBe(created.id);

      await service.deactivate(created.id);

      await expect(service.findOne(created.id)).rejects.toThrow(NotFoundException);
    });
  });
});
