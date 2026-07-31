import { TenantContextService } from '@hospital/tenant-context';
import { dataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreatePatientTables005 } from '../database/migrations/005_create_patient_tables.js';
import { Patient } from './entities/patient.entity.js';
import { PatientAddress } from './entities/patient-address.entity.js';
import { PatientKin } from './entities/patient-kin.entity.js';

describe('Patient Entities & Migration (integration)', () => {
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  const schema = 'tenant_patient_test';

  beforeAll(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);

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

  it('inserts and retrieves patient with addresses and kins in tenant schema', async () => {
    await tenantContext.run({ tenantId: 'patient_test', correlationId: 'c1' }, async () => {
      await tenantConnection.runInTenantSchema(async (manager) => {
        const patient = manager.create(Patient, {
          patientNo: 'PAT-2026-00001',
          firstName: 'John',
          lastName: 'Doe',
          gender: 'Male',
          phoneNumber: '9876543210',
          addresses: [
            manager.create(PatientAddress, { streetAddress: '123 Main St', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001' })
          ],
          kins: [
            manager.create(PatientKin, { kinName: 'Jane Doe', relationship: 'Spouse', phoneNumber: '9876543211' })
          ]
        });
        await manager.save(patient);

        const found = await manager.findOne(Patient, {
          where: { patientNo: 'PAT-2026-00001' },
          relations: { addresses: true, kins: true },
        });

        expect(found).toBeDefined();
        expect(found?.firstName).toBe('John');
        expect(found?.addresses).toHaveLength(1);
        expect(found?.addresses[0].city).toBe('Mumbai');
        expect(found?.kins).toHaveLength(1);
        expect(found?.kins[0].kinName).toBe('Jane Doe');
      });
    });
  });
});
