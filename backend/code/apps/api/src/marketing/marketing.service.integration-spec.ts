import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MarketingService } from './marketing.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('MarketingService (integration)', () => {
  let ctx: TenantTestContext;
  let marketingService: MarketingService;
  let patientsService: PatientsService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'marketing' });
    marketingService = new MarketingService(ctx.tenantConnection, ctx.tenantContext);
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'marketing-test' },
      work,
    );
  }

  let seq = 0;
  async function makePatient() {
    seq += 1;
    return ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Referred',
        lastName: `Patient${seq}`,
        dateOfBirth: '1990-02-02',
        gender: 'Male',
        phoneNumber: `5580000${String(seq).padStart(3, '0')}`,
      }),
    );
  }

  async function makeSource(name: string, overrides: Record<string, unknown> = {}) {
    return ctx.inTenant(() => marketingService.createSource({ name, ...overrides }));
  }

  it('creates referral sources and validates input', async () => {
    const source = await makeSource('Google Search');
    expect(source.name).toBe('Google Search');
    expect(source.sourceType).toBe('Other'); // default when omitted
    expect(source.isActive).toBe(true);

    const doctor = await makeSource('Dr. Sharma', { sourceType: 'Doctor' });
    expect(doctor.sourceType).toBe('Doctor');

    await expect(
      ctx.inTenant(() => marketingService.createSource({ name: '   ' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => marketingService.createSource({ name: 'TV' as never, sourceType: 'Television' as never })),
    ).rejects.toThrow(BadRequestException);

    // Duplicate source names are rejected (P3 — previously nothing enforced uniqueness).
    await expect(
      ctx.inTenant(() => marketingService.createSource({ name: 'Google Search' })),
    ).rejects.toThrow(ConflictException);
  });

  it('deactivates/reactivates sources; double-deactivate conflicts; deactivated sources reject referrals', async () => {
    const source = await makeSource('Billboard');

    await ctx.inTenant(() => marketingService.deactivateSource(source.id));
    await expect(ctx.inTenant(() => marketingService.deactivateSource(source.id))).rejects.toThrow(
      ConflictException,
    );

    await ctx.inTenant(() => marketingService.reactivateSource(source.id));
    const active = (await ctx.inTenant(() => marketingService.listSources())).find(
      (s) => s.id === source.id,
    );
    expect(active?.isActive).toBe(true);

    // A deactivated source cannot accept new referrals.
    await ctx.inTenant(() => marketingService.deactivateSource(source.id));
    const patient = await makePatient();
    await expect(
      ctx.inTenant(() =>
        marketingService.recordReferral({ patientId: patient.id, sourceId: source.id }),
      ),
    ).rejects.toThrow(ConflictException);

    await expect(
      ctx.inTenant(() =>
        marketingService.deactivateSource('00000000-0000-0000-0000-000000000000'),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists sources ordered by name', async () => {
    await makeSource('Zeta Clinic');
    await makeSource('Alpha Radio');
    const sources = await ctx.inTenant(() => marketingService.listSources());
    const names = sources.map((s) => s.name);
    expect([...names].sort()).toEqual(names);
  });

  it('records a referral against a real patient with actor-derived recordedBy', async () => {
    const patient = await makePatient();
    const source = await makeSource('Facebook Ads', { sourceType: 'Social Media' });

    const referral = await withActor(() =>
      marketingService.recordReferral({
        patientId: patient.id,
        sourceId: source.id,
        referredByDoctorId: STAFF_ID,
        referredAt: '2025-07-01T10:00:00Z',
        notes: 'Came via FB campaign',
      }),
    );
    expect(referral.patientId).toBe(patient.id);
    expect(referral.sourceId).toBe(source.id);
    expect(referral.referredByDoctorId).toBe(STAFF_ID);
    expect(referral.notes).toBe('Came via FB campaign');
    // Section 25: the authenticated principal wins over any caller-supplied value.
    expect(referral.recordedBy).toBe(AUTHENTICATED_ACCOUNT);
    expect(referral.referredAt.toISOString()).toBe('2025-07-01T10:00:00.000Z');

    // Non-HTTP callers fall back to the supplied actor.
    const fallback = await ctx.inTenant(() =>
      marketingService.recordReferral({
        patientId: patient.id,
        sourceId: source.id,
        recordedBy: STAFF_ID,
      }),
    );
    expect(fallback.recordedBy).toBe(STAFF_ID);
    expect(fallback.referredAt).not.toBeNull();
  });

  it('rejects referrals for unknown patients or sources, and bad dates', async () => {
    const patient = await makePatient();
    const source = await makeSource('Word of Mouth', { sourceType: 'Walk-in' });

    await expect(
      ctx.inTenant(() =>
        marketingService.recordReferral({
          patientId: '00000000-0000-0000-0000-000000000000',
          sourceId: source.id,
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      ctx.inTenant(() =>
        marketingService.recordReferral({
          patientId: patient.id,
          sourceId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      ctx.inTenant(() =>
        marketingService.recordReferral({
          patientId: patient.id,
          sourceId: source.id,
          referredAt: 'not-a-date',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('filters referrals by patient and source, newest first', async () => {
    const patientA = await makePatient();
    const patientB = await makePatient();
    const sourceX = await makeSource('Newspaper Ad', { sourceType: 'Advertising' });
    const sourceY = await makeSource('Hospital Website');

    await ctx.inTenant(() =>
      marketingService.recordReferral({ patientId: patientA.id, sourceId: sourceX.id, recordedBy: STAFF_ID }),
    );
    await ctx.inTenant(() =>
      marketingService.recordReferral({ patientId: patientB.id, sourceId: sourceX.id, recordedBy: STAFF_ID }),
    );
    await ctx.inTenant(() =>
      marketingService.recordReferral({ patientId: patientA.id, sourceId: sourceY.id, recordedBy: STAFF_ID }),
    );

    const forPatientA = await ctx.inTenant(() =>
      marketingService.listReferrals({ patientId: patientA.id }),
    );
    expect(forPatientA.data).toHaveLength(2);
    expect(forPatientA.data.every((r) => r.patientId === patientA.id)).toBe(true);
    expect(forPatientA.meta.total).toBe(2);

    const forSourceX = await ctx.inTenant(() =>
      marketingService.listReferrals({ sourceId: sourceX.id }),
    );
    expect(forSourceX.data).toHaveLength(2);

    const both = await ctx.inTenant(() =>
      marketingService.listReferrals({ patientId: patientB.id, sourceId: sourceX.id }),
    );
    expect(both.data).toHaveLength(1);

    // Newest first by referredAt.
    const times = forPatientA.data.map((r) => new Date(r.referredAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('gets a single referral and enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const patient = await makePatient();
    const source = await makeSource('Tenant Isolation Source');
    const referral = await ctx.inTenant(() =>
      marketingService.recordReferral({ patientId: patient.id, sourceId: source.id, recordedBy: STAFF_ID }),
    );

    const fetched = await ctx.inTenant(() => marketingService.getReferral(referral.id));
    expect(fetched.id).toBe(referral.id);

    // Tenant B cannot see tenant A's data.
    await expect(tenantB.inTenant(() => marketingService.getReferral(referral.id))).rejects.toThrow(
      NotFoundException,
    );
    const referrals = await tenantB.inTenant(() => marketingService.listReferrals({}));
    expect(referrals.data.map((r) => r.id)).not.toContain(referral.id);
    const sources = await tenantB.inTenant(() => marketingService.listSources());
    expect(sources.map((s) => s.id)).not.toContain(source.id);
  });
});
