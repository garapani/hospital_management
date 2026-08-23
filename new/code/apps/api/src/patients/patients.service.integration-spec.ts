import { ConflictException, NotFoundException } from '@nestjs/common';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { PatientsService } from './patients.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('PatientsService (integration)', () => {
  let ctx: TenantTestContext;
  let service: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'patients_svc' });
    const generatorService = new PatientNumberGeneratorService(ctx.tenantConnection);
    service = new PatientsService(ctx.tenantConnection, generatorService, new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('registers patient and triggers conflict exception on duplicate phone without override', async () => {
    await ctx.inTenant(async () => {
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
    await ctx.inTenant(async () => {
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
    await ctx.inTenant(async () => {
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

  describe('createPortalInvite', () => {
    it('creates a portal account linked to the patient, deriving displayName and falling back to the patient email', async () => {
      await ctx.inTenant(async () => {
        const patient = await service.create({
          firstName: 'Portal',
          lastName: 'Patient',
          gender: 'Female',
          email: 'portal.patient@example.com',
        });

        const account = await service.createPortalInvite(patient.id, {
          username: `portal.patient.${Date.now()}`,
        });

        expect(account.accountType).toBe('patient');
        expect(account.patientId).toBe(patient.id);
        expect(account.displayName).toBe('Portal Patient');
        expect(account.email).toBe('portal.patient@example.com');
        expect(account.initialPassword).toBeTruthy();
      });
    });

    it('throws NotFoundException for a nonexistent patient', async () => {
      await ctx.inTenant(async () => {
        await expect(
          service.createPortalInvite('00000000-0000-0000-0000-000000000000', {
            username: 'nobody',
          }),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });
});
