import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('PatientNumberGeneratorService (integration)', () => {
  let ctx: TenantTestContext;
  let generatorService: PatientNumberGeneratorService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'patient_num_gen' });
    generatorService = new PatientNumberGeneratorService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('generates sequential patient numbers in tenant schema', async () => {
    await ctx.inTenant(async () => {
      const year = new Date().getFullYear();
      const num1 = await generatorService.generateNextPatientNumber('PAT');
      const num2 = await generatorService.generateNextPatientNumber('PAT');

      expect(num1).toBe(`PAT-${year}-00001`);
      expect(num2).toBe(`PAT-${year}-00002`);
    });
  });
});
