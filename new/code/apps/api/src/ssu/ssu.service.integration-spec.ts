import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SsuService } from './ssu.service.js';
import { SsuCaseNumberGeneratorService } from './ssu-case-number-generator.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('SsuService (integration)', () => {
  let ctx: TenantTestContext;
  let ssuService: SsuService;
  let patientsService: PatientsService;

  const STAFF_ID = '00000000-0000-0000-0000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'ssu' });
    ssuService = new SsuService(
      ctx.tenantConnection,
      new SsuCaseNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
    );
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'ssu-test' },
      work,
    );
  }

  let seq = 0;
  async function makePatient() {
    seq += 1;
    return ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Charity',
        lastName: `Patient${seq}`,
        dateOfBirth: '1980-01-01',
        gender: 'Female',
        phoneNumber: `5590000${String(seq).padStart(3, '0')}`,
      }),
    );
  }

  async function makeCase(patientId: string, overrides: Record<string, unknown> = {}) {
    return ctx.inTenant(() =>
      ssuService.openCase({
        patientId,
        caseType: 'Full Subsidy',
        eligibilityNotes: 'BPL card holder',
        subsidyPercent: 100,
        appliedBy: STAFF_ID,
        ...overrides,
      }),
    );
  }

  it('opens cases with an auto SSU number and validates input', async () => {
    const patient = await makePatient();
    const ssuCase = await makeCase(patient.id);
    expect(ssuCase.caseNumber).toMatch(/^SSU-\d{4}-\d+$/);
    expect(ssuCase.status).toBe('Open');
    expect(ssuCase.caseType).toBe('Full Subsidy');
    expect(ssuCase.subsidyPercent).toBe(100);
    expect(ssuCase.appliedBy).toBe(STAFF_ID);
    expect(ssuCase.approvedBy).toBeNull();
    expect(ssuCase.approvedAt).toBeNull();

    // caseType must be non-blank.
    await expect(
      ctx.inTenant(() => ssuService.openCase({ patientId: patient.id, caseType: '   ', appliedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
    // subsidyPercent must be within 0-100.
    await expect(
      ctx.inTenant(() =>
        ssuService.openCase({ patientId: patient.id, caseType: 'X', subsidyPercent: 150, appliedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        ssuService.openCase({ patientId: patient.id, caseType: 'X', subsidyPercent: -1, appliedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
    // Patient must exist.
    await expect(
      ctx.inTenant(() =>
        ssuService.openCase({
          patientId: '00000000-0000-0000-0000-000000000000',
          caseType: 'X',
          appliedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      ctx.inTenant(() => ssuService.getCase('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('runs the full lifecycle and rejects invalid moves', async () => {
    const patient = await makePatient();
    const ssuCase = await makeCase(patient.id);

    // Cannot close a case straight from Open (must be decided first).
    await expect(ctx.inTenant(() => ssuService.closeCase(ssuCase.id))).rejects.toThrow(ConflictException);

    // Open -> Approved, recording the decision note.
    const approved = await ctx.inTenant(() =>
      ssuService.approveCase(ssuCase.id, { decisionNotes: 'Approved by committee' }),
    );
    expect(approved.status).toBe('Approved');
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.decisionNotes).toBe('Approved by committee');
    // Cannot approve twice.
    await expect(ctx.inTenant(() => ssuService.approveCase(ssuCase.id))).rejects.toThrow(ConflictException);
    // Cannot reject an already-approved case.
    await expect(ctx.inTenant(() => ssuService.rejectCase(ssuCase.id, { decisionNotes: 'nope' }))).rejects.toThrow(
      ConflictException,
    );

    const closed = await ctx.inTenant(() => ssuService.closeCase(ssuCase.id));
    expect(closed.status).toBe('Closed');
    // Terminal state: no further transitions.
    await expect(ctx.inTenant(() => ssuService.closeCase(ssuCase.id))).rejects.toThrow(ConflictException);
    await expect(ctx.inTenant(() => ssuService.approveCase(ssuCase.id))).rejects.toThrow(ConflictException);

    // Rejection path: notes required, then Open -> Rejected -> Closed.
    const toReject = await makeCase(patient.id);
    await expect(ctx.inTenant(() => ssuService.rejectCase(toReject.id, { decisionNotes: '  ' }))).rejects.toThrow(
      BadRequestException,
    );
    const rejected = await ctx.inTenant(() => ssuService.rejectCase(toReject.id, { decisionNotes: 'Not eligible' }));
    expect(rejected.status).toBe('Rejected');
    expect(rejected.decisionNotes).toBe('Not eligible');
    expect(rejected.approvedAt).not.toBeNull();
    // Cannot approve a rejected case.
    await expect(ctx.inTenant(() => ssuService.approveCase(toReject.id))).rejects.toThrow(ConflictException);

    const closedRejected = await ctx.inTenant(() => ssuService.closeCase(toReject.id));
    expect(closedRejected.status).toBe('Closed');
  });

  it('derives appliedBy and approvedBy from the authenticated principal', async () => {
    const patient = await makePatient();
    const spoofed = '00000000-0000-0000-0000-0000000000ff';
    const ssuCase = await withActor(() =>
      ssuService.openCase({
        patientId: patient.id,
        caseType: '50% Subsidy',
        subsidyPercent: 50,
        appliedBy: spoofed,
      }),
    );
    // Section 25: the authenticated principal wins over any caller-supplied value.
    expect(ssuCase.appliedBy).toBe(AUTHENTICATED_ACCOUNT);

    const approved = await withActor(() => ssuService.approveCase(ssuCase.id, { approvedBy: spoofed }));
    expect(approved.status).toBe('Approved');
    expect(approved.approvedBy).toBe(AUTHENTICATED_ACCOUNT);
    expect(approved.approvedAt).not.toBeNull();
  });

  it('filters cases by patientId and status', async () => {
    const patient = await makePatient();
    const first = await makeCase(patient.id);
    await makeCase(patient.id, { caseType: 'Medicine Only', subsidyPercent: 75 });
    const approved = await ctx.inTenant(() => ssuService.approveCase(first.id, { decisionNotes: 'ok' }));

    const patientList = await ctx.inTenant(() => ssuService.listCases({ patientId: patient.id }));
    expect(patientList.data.map((c) => c.id)).toContain(approved.id);
    expect(patientList.meta.total).toBeGreaterThanOrEqual(2);

    const approvedList = await ctx.inTenant(() => ssuService.listCases({ status: 'Approved' }));
    expect(approvedList.data.map((c) => c.id)).toContain(approved.id);
    expect(approvedList.data.every((c) => c.status === 'Approved')).toBe(true);
  });

  it('enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const patient = await makePatient();
    const ssuCase = await makeCase(patient.id);
    await expect(tenantB.inTenant(() => ssuService.getCase(ssuCase.id))).rejects.toThrow(NotFoundException);
    const list = await tenantB.inTenant(() => ssuService.listCases({}));
    expect(list.data.map((c) => c.id)).not.toContain(ssuCase.id);
  });
});
