import { Patient } from './entities/patient.entity.js';
import { PatientAddress } from './entities/patient-address.entity.js';
import { PatientKin } from './entities/patient-kin.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('Patient Entities & Migration (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'patient_entities' });
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('inserts and retrieves patient with addresses and kins in tenant schema', async () => {
    await ctx.inTenant(async () => {
      await ctx.tenantConnection.runInTenantSchema(async (manager) => {
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
