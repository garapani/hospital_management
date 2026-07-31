import { TenantContextService } from '@hospital/tenant-context';
import { dataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreatePatientTables005 } from '../database/migrations/005_create_patient_tables.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';

describe('PatientNumberGeneratorService (integration)', () => {
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let generatorService: PatientNumberGeneratorService;
  const schema = 'tenant_patient_num_test';

  beforeAll(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    generatorService = new PatientNumberGeneratorService(tenantConnection);

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

  it('generates sequential patient numbers in tenant schema', async () => {
    await tenantContext.run({ tenantId: 'patient_num_test', correlationId: 'c1' }, async () => {
      const year = new Date().getFullYear();
      const num1 = await generatorService.generateNextPatientNumber('PAT');
      const num2 = await generatorService.generateNextPatientNumber('PAT');

      expect(num1).toBe(`PAT-${year}-00001`);
      expect(num2).toBe(`PAT-${year}-00002`);
    });
  });
});
