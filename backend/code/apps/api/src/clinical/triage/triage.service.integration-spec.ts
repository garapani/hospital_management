import { ConflictException, NotFoundException } from '@nestjs/common';
import { TriageService } from './triage.service.js';
import { PatientsService } from '../../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../../patients/patient-number-generator.service.js';
import { AccountsService } from '../../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../../testing/tenant-test-context.js';

describe('TriageService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let triageService: TriageService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'triage_svc' });
    tenantB = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence, new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
    triageService = new TriageService(ctx.tenantConnection, ctx.tenantContext);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
  });

  it('registers an ER arrival for a known patient', async () => {
    await ctx.inTenant(async () => {
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
    await ctx.inTenant(async () => {
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
    await tenantB.inTenant(async () => {
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
    await tenantB.inTenant(async () => {
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

  it('rejects linking to a nonexistent patient', async () => {
    await tenantB.inTenant(async () => {
      const entry = await triageService.create({ chiefComplaint: 'Unlinked' });
      await expect(
        triageService.linkPatient(entry.id, '11111111-1111-1111-1111-111111111111'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('rejects re-linking an entry that already has a patient', async () => {
    await tenantB.inTenant(async () => {
      const entry = await triageService.create({ chiefComplaint: 'Already linked' });
      const patientA = await patientsService.create({
        firstName: 'A', lastName: 'Patient', gender: 'Female', phoneNumber: '3333333333',
      });
      const patientB = await patientsService.create({
        firstName: 'B', lastName: 'Patient', gender: 'Female', phoneNumber: '4444444444',
      });
      await triageService.linkPatient(entry.id, patientA.id);

      await expect(triageService.linkPatient(entry.id, patientB.id)).rejects.toThrow(ConflictException);
    });
  });

  it('rejects linking a closed entry to a patient', async () => {
    await tenantB.inTenant(async () => {
      const entry = await triageService.create({ chiefComplaint: 'Will be discharged' });
      await triageService.update(entry.id, { status: 'Discharged' });
      const patient = await patientsService.create({
        firstName: 'Closed', lastName: 'Entry', gender: 'Female', phoneNumber: '5555555555',
      });

      await expect(triageService.linkPatient(entry.id, patient.id)).rejects.toThrow(ConflictException);
    });
  });

  it('rejects updating a closed entry', async () => {
    await ctx.inTenant(async () => {
      const entry = await triageService.create({ chiefComplaint: 'Will be discharged' });
      await triageService.update(entry.id, { status: 'Discharged' });

      await expect(triageService.update(entry.id, { chiefComplaint: 'trying to edit' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  it('lists active entries ordered by acuity then triagedAt, excluding closed entries', async () => {
    await ctx.inTenant(async () => {
      const low = await triageService.create({ chiefComplaint: 'Low priority' });
      const high = await triageService.create({ chiefComplaint: 'High priority' });
      const closed = await triageService.create({ chiefComplaint: 'Already handled' });

      await triageService.update(low.id, { acuityLevel: 4, status: 'Triaged' });
      await triageService.update(high.id, { acuityLevel: 1, status: 'Triaged' });
      await triageService.update(closed.id, { acuityLevel: 2, status: 'Discharged' });

      const active = await triageService.listActive();
      const ids = active.data.map((e) => e.id);

      expect(ids).not.toContain(closed.id);
      expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id));
    });
  });

  it('paginates active entries', async () => {
    await ctx.inTenant(async () => {
      for (let i = 0; i < 3; i++) {
        await triageService.create({ chiefComplaint: `Entry ${i}` });
      }

      const page1 = await triageService.listActive({ page: 1, limit: 2 });
      expect(page1.data).toHaveLength(2);
      expect(page1.meta.total).toBeGreaterThanOrEqual(3);
      expect(page1.meta.totalPages).toBeGreaterThanOrEqual(2);
    });
  });

  it('throws NotFoundException when updating a non-existent entry', async () => {
    await ctx.inTenant(async () => {
      await expect(
        triageService.update('00000000-0000-0000-0000-000000000000', { status: 'Triaged' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('enforces tenant isolation for triage entries', async () => {
    let sharedEntryId: string;

    await ctx.inTenant(async () => {
      const entry = await triageService.create({ chiefComplaint: 'Isolated case' });
      sharedEntryId = entry.id;
    });

    await tenantB.inTenant(async () => {
      await expect(triageService.findOne(sharedEntryId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('actor fields derive from the authenticated principal, never the caller-supplied value', () => {
    // Unlike ctx.inTenant(), this run() sets an accountId — exactly what
    // TenantContextMiddleware does for a real HTTP request (from req.authContext.sub). The
    // service must record THIS account, ignoring the spoofed value passed to it.
    const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

    function withActor<T>(work: () => Promise<T>): Promise<T> {
      return ctx.tenantContext.run(
        { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'actor-test' },
        work,
      );
    }

    it('create records the authenticated account as triagedBy, never the body value', async () => {
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const entry = await withActor(() =>
        triageService.create({ chiefComplaint: 'Chest pain', triagedBy: spoofed }),
      );
      expect(entry.triagedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('update records the authenticated account as triagedBy, never the spoofed value', async () => {
      const entry = await ctx.inTenant(() => triageService.create({ chiefComplaint: 'Fever' }));
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const updated = await withActor(() =>
        triageService.update(entry.id, { status: 'Triaged', triagedBy: spoofed }),
      );
      expect(updated.triagedBy).toBe(AUTHENTICATED_ACCOUNT);

      const persisted = await ctx.inTenant(() => triageService.findOne(entry.id));
      expect(persisted.triagedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});
