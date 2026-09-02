import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InsuranceClaimsService } from './insurance-claims.service.js';
import { InsuranceClaimNumberGeneratorService } from './insurance-claim-number-generator.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalNumberGeneratorService } from '../accounting/journal-number-generator.service.js';
import { PdfService } from '@hospital/pdf';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InsuranceClaimsService (integration)', () => {
  let ctx: TenantTestContext;
  let insuranceService: InsuranceClaimsService;
  let patientsService: PatientsService;
  let invoicesService: InvoicesService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'insurance' });
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection), new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext), new PdfService());
    invoicesService = new InvoicesService(
      ctx.tenantConnection,
      ctx.tenantContext,
      new AccountingService(ctx.tenantConnection, new JournalNumberGeneratorService(ctx.tenantConnection), ctx.tenantContext),
    );
    insuranceService = new InsuranceClaimsService(
      ctx.tenantConnection,
      new InsuranceClaimNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
      invoicesService,
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'insurance-test' },
      work,
    );
  }

  let seq = 0;
  async function makePatient() {
    seq += 1;
    return ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Insured',
        lastName: `Patient${seq}`,
        dateOfBirth: '1985-05-05',
        gender: 'Female',
        phoneNumber: `5570000${String(seq).padStart(3, '0')}`,
      }),
    );
  }

  async function makePayer(name: string, type: 'Government' | 'Private' = 'Private') {
    return ctx.inTenant(() => insuranceService.createPayer({ name, type }));
  }

  async function makePolicy(patientId: string, payerId: string, overrides: Record<string, unknown> = {}) {
    return ctx.inTenant(() =>
      insuranceService.createPolicy({
        patientId,
        payerId,
        policyNumber: `POL-${++seq}`,
        coverageStartDate: '2024-01-01',
        coverageEndDate: '2026-12-31',
        sumInsured: 500000,
        copayPercent: 10,
        ...overrides,
      }),
    );
  }

  async function makeInvoice(patientId: string) {
    return ctx.inTenant(() =>
      invoicesService.create({
        patientId,
        createdBy: STAFF_ID,
        items: [{ description: 'Consultation', unitPrice: 1500 }],
      }),
    );
  }

  it('creates payers and validates type', async () => {
    const payer = await makePayer('Star Health', 'Private');
    expect(payer.name).toBe('Star Health');
    expect(payer.type).toBe('Private');
    expect(payer.isActive).toBe(true);

    await expect(
      ctx.inTenant(() => insuranceService.createPayer({ name: 'Bad', type: 'Mutual' as never })),
    ).rejects.toThrow(BadRequestException);
  });

  it('deactivates/reactivates payers; deactivated payers reject new policies', async () => {
    const payer = await makePayer('CGHS', 'Government');
    await ctx.inTenant(() => insuranceService.deactivatePayer(payer.id));
    await expect(ctx.inTenant(() => insuranceService.deactivatePayer(payer.id))).rejects.toThrow(
      ConflictException,
    );
    await ctx.inTenant(() => insuranceService.reactivatePayer(payer.id));

    await ctx.inTenant(() => insuranceService.deactivatePayer(payer.id));
    const patient = await makePatient();
    await expect(ctx.inTenant(() => makePolicy(patient.id, payer.id))).rejects.toThrow(ConflictException);
  });

  it('creates policies, validating the coverage window, copay, and references', async () => {
    const patient = await makePatient();
    const payer = await makePayer('HDFC ERGO');
    const policy = await makePolicy(patient.id, payer.id);
    expect(policy.copayPercent).toBe(10);
    expect(policy.sumInsured).toBe(500000);

    await expect(
      ctx.inTenant(() =>
        insuranceService.createPolicy({
          patientId: patient.id,
          payerId: payer.id,
          policyNumber: 'BAD-WINDOW',
          coverageStartDate: '2026-01-01',
          coverageEndDate: '2025-01-01',
          sumInsured: 100,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        insuranceService.createPolicy({
          patientId: patient.id,
          payerId: payer.id,
          policyNumber: 'BAD-COPAY',
          coverageStartDate: '2024-01-01',
          coverageEndDate: '2026-01-01',
          sumInsured: 100,
          copayPercent: 150,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        insuranceService.createPolicy({
          patientId: '00000000-0000-0000-0000-000000000000',
          payerId: payer.id,
          policyNumber: 'NO-PATIENT',
          coverageStartDate: '2024-01-01',
          coverageEndDate: '2026-01-01',
          sumInsured: 100,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('checks coverage: active + in-window eligible, otherwise not', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Bajaj Allianz');
    const policy = await makePolicy(patient.id, payer.id);

    const inside = await ctx.inTenant(() => insuranceService.checkCoverage(policy.id, '2025-06-15'));
    expect(inside.eligible).toBe(true);
    expect(inside.copayPercent).toBe(10);

    const outside = await ctx.inTenant(() => insuranceService.checkCoverage(policy.id, '2027-06-15'));
    expect(outside.eligible).toBe(false);
    expect(outside.reason).toBe('outside-coverage-window');

    await ctx.inTenant(() => insuranceService.deactivatePolicy(policy.id));
    const inactive = await ctx.inTenant(() => insuranceService.checkCoverage(policy.id, '2025-06-15'));
    expect(inactive.eligible).toBe(false);
    expect(inactive.reason).toBe('policy-inactive');
  });

  it('runs the full claims lifecycle with actor derivation', async () => {
    const patient = await makePatient();
    const payer = await makePayer('New India Assurance');
    const policy = await makePolicy(patient.id, payer.id);
    const invoice = await makeInvoice(patient.id);

    const claim = await withActor(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoice.id,
        amountClaimed: 1200,
        remarks: 'OPD consultation',
      }),
    );
    expect(claim.status).toBe('Draft');
    expect(claim.claimNumber).toMatch(/^CLM-\d{4}-\d+$/);
    // Actor derivation (section 25): the authenticated principal wins over any caller value.
    expect(claim.submittedBy).toBe(AUTHENTICATED_ACCOUNT);

    const submitted = await withActor(() => insuranceService.submitClaim(claim.id));
    expect(submitted.status).toBe('Submitted');
    expect(submitted.submittedAt).not.toBeNull();

    const approved = await withActor(() => insuranceService.approveClaim(claim.id, 1100));
    expect(approved.status).toBe('Approved');
    expect(approved.amountApproved).toBe(1100);
    expect(approved.processedBy).toBe(AUTHENTICATED_ACCOUNT);

    const paid = await withActor(() => insuranceService.markClaimPaid(claim.id));
    expect(paid.status).toBe('Paid');
    expect(paid.processedBy).toBe(AUTHENTICATED_ACCOUNT);

    // markClaimPaid moves money: an 'Insurance' payment lands on the invoice (P2).
    const invoiceAfter = await ctx.inTenant(() => invoicesService.findOne(invoice.id));
    expect(invoiceAfter.payments).toHaveLength(1);
    expect(invoiceAfter.payments[0].paymentMode).toBe('Insurance');
    expect(invoiceAfter.payments[0].amount).toBe(1100);
    expect(invoiceAfter.paidAmount).toBe(1100);
    expect(invoiceAfter.status).toBe('PartiallyPaid');
  });

  it('supports partial policy updates without resending policyNumber', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Partial Update Payer');
    const policy = await makePolicy(patient.id, payer.id);

    // A one-field update must not demand policyNumber (previously the shared validator required
    // it, making the endpoint unusable for partial updates).
    const updated = await ctx.inTenant(() =>
      insuranceService.updatePolicy(policy.id, { insuredName: 'Renamed Insured' }),
    );
    expect(updated.insuredName).toBe('Renamed Insured');
    expect(updated.policyNumber).toBe(policy.policyNumber);

    // Administrative fields stay editable.
    const renumbered = await ctx.inTenant(() =>
      insuranceService.updatePolicy(policy.id, { policyNumber: 'POL-RENUMBERED' }),
    );
    expect(renumbered.policyNumber).toBe('POL-RENUMBERED');
  });

  it('freezes coverage terms once a policy has claims', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Freeze Payer');
    const policy = await makePolicy(patient.id, payer.id);
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoice.id,
        amountClaimed: 500,
        submittedBy: STAFF_ID,
      }),
    );

    // Coverage terms are the basis of approvals — frozen once claims exist (P3).
    await expect(
      ctx.inTenant(() => insuranceService.updatePolicy(policy.id, { sumInsured: 100000 })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => insuranceService.updatePolicy(policy.id, { coverageEndDate: '2030-12-31' })),
    ).rejects.toThrow(ConflictException);

    // Administrative fields are still fine.
    const updated = await ctx.inTenant(() =>
      insuranceService.updatePolicy(policy.id, { insuredName: 'Still Editable' }),
    );
    expect(updated.insuredName).toBe('Still Editable');
  });

  it('rejects a duplicate policy for the same patient/payer/number', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Dup Payer');
    await makePolicy(patient.id, payer.id, { policyNumber: 'POL-DUP-1' });

    await expect(
      ctx.inTenant(() =>
        insuranceService.createPolicy({
          patientId: patient.id,
          payerId: payer.id,
          policyNumber: 'POL-DUP-1',
          coverageStartDate: '2024-01-01',
          coverageEndDate: '2026-12-31',
          sumInsured: 500000,
        }),
      ),
    ).rejects.toThrow(ConflictException);

    // Same number under a DIFFERENT payer is a distinct policy — allowed.
    const otherPayer = await makePayer('Other Payer');
    const distinct = await ctx.inTenant(() =>
      insuranceService.createPolicy({
        patientId: patient.id,
        payerId: otherPayer.id,
        policyNumber: 'POL-DUP-1',
        coverageStartDate: '2024-01-01',
        coverageEndDate: '2026-12-31',
        sumInsured: 500000,
      }),
    );
    expect(distinct.payerId).toBe(otherPayer.id);
  });

  it('treats a deactivated payer as ineligible in checkCoverage', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Deact Payer');
    const policy = await makePolicy(patient.id, payer.id);
    await ctx.inTenant(() => insuranceService.deactivatePayer(payer.id));

    const coverage = await ctx.inTenant(() => insuranceService.checkCoverage(policy.id, '2026-06-01'));
    expect(coverage.eligible).toBe(false);
    expect(coverage.reason).toBe('payer-inactive');
  });

  // Regression tests for the P1 in code-review-findings-2026-08-25.md: nothing capped total
  // claims against an invoice or a policy's sumInsured.
  it('rejects a claim that would bring total claims against the invoice above its total', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Claim Cap Payer');
    const policy = await makePolicy(patient.id, payer.id);
    const invoice = await makeInvoice(patient.id); // totalAmount 1500

    await ctx.inTenant(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoice.id,
        amountClaimed: 1000,
        submittedBy: STAFF_ID,
      }),
    );

    // 1000 (existing Draft claim) + 600 would total 1600, over the invoice's 1500.
    await expect(
      ctx.inTenant(() =>
        insuranceService.createClaim({
          patientId: patient.id,
          policyId: policy.id,
          invoiceId: invoice.id,
          amountClaimed: 600,
          submittedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('a rejected claim does not count toward the invoice cap', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Rejected Claim Cap Payer');
    const policy = await makePolicy(patient.id, payer.id);
    const invoice = await makeInvoice(patient.id); // totalAmount 1500

    const claim = await ctx.inTenant(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoice.id,
        amountClaimed: 1200,
        submittedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() => insuranceService.submitClaim(claim.id, STAFF_ID));
    await ctx.inTenant(() => insuranceService.rejectClaim(claim.id, 'Not covered', STAFF_ID));

    // The rejected 1200 claim must not count against the 1500 cap.
    const second = await ctx.inTenant(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoice.id,
        amountClaimed: 1200,
        submittedBy: STAFF_ID,
      }),
    );
    expect(second.amountClaimed).toBe(1200);
  });

  it('rejects an approval that would bring total approved claims against the policy above its sumInsured', async () => {
    const patient = await makePatient();
    const payer = await makePayer('Sum Insured Cap Payer');
    const policy = await makePolicy(patient.id, payer.id, { sumInsured: 1500 });
    const invoiceA = await makeInvoice(patient.id);
    const invoiceB = await makeInvoice(patient.id);

    const claimA = await ctx.inTenant(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoiceA.id,
        amountClaimed: 1000,
        submittedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() => insuranceService.submitClaim(claimA.id, STAFF_ID));
    await ctx.inTenant(() => insuranceService.approveClaim(claimA.id, 1000, STAFF_ID));

    const claimB = await ctx.inTenant(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoiceB.id,
        amountClaimed: 1000,
        submittedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() => insuranceService.submitClaim(claimB.id, STAFF_ID));

    // 1000 (already approved) + 1000 would total 2000, over the policy's sumInsured of 1500.
    await expect(
      ctx.inTenant(() => insuranceService.approveClaim(claimB.id, 1000, STAFF_ID)),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces the status machine and validates amounts/remarks', async () => {
    const patient = await makePatient();
    const payer = await makePayer('SBI General');
    const policy = await makePolicy(patient.id, payer.id);
    const invoice = await makeInvoice(patient.id);

    const claim = await ctx.inTenant(() =>
      insuranceService.createClaim({
        patientId: patient.id,
        policyId: policy.id,
        invoiceId: invoice.id,
        amountClaimed: 1000,
        submittedBy: STAFF_ID,
      }),
    );

    // Cannot approve a Draft claim.
    await expect(ctx.inTenant(() => insuranceService.approveClaim(claim.id, 500))).rejects.toThrow(
      ConflictException,
    );
    // Amount validation on creation.
    await expect(
      ctx.inTenant(() =>
        insuranceService.createClaim({
          patientId: patient.id,
          policyId: policy.id,
          invoiceId: invoice.id,
          amountClaimed: 0,
          submittedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    await ctx.inTenant(() => insuranceService.submitClaim(claim.id));
    // Approval above claimed amount is rejected.
    await expect(ctx.inTenant(() => insuranceService.approveClaim(claim.id, 2000))).rejects.toThrow(
      BadRequestException,
    );
    // Rejection requires remarks.
    await expect(ctx.inTenant(() => insuranceService.rejectClaim(claim.id, '  '))).rejects.toThrow(
      BadRequestException,
    );
    const rejected = await ctx.inTenant(() => insuranceService.rejectClaim(claim.id, 'Not covered'));
    expect(rejected.status).toBe('Rejected');
    // A rejected claim cannot be paid.
    await expect(ctx.inTenant(() => insuranceService.markClaimPaid(claim.id))).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects claims against another patient\'s policy or invoice', async () => {
    const patientA = await makePatient();
    const patientB = await makePatient();
    const payer = await makePayer('Tata AIG');
    const policyA = await makePolicy(patientA.id, payer.id);
    const invoiceB = await makeInvoice(patientB.id);

    await expect(
      ctx.inTenant(() =>
        insuranceService.createClaim({
          patientId: patientB.id,
          policyId: policyA.id,
          invoiceId: invoiceB.id,
          amountClaimed: 500,
          submittedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException); // policy does not belong to patient B
  });

  it('enforces tenant isolation for claims', async () => {
    const tenantB = await ctx.createTenant();
    const patient = await makePatient();
    const payer = await makePayer('Tenant Isolation Payer');
    const policy = await makePolicy(patient.id, payer.id);

    await expect(
      tenantB.inTenant(() => insuranceService.getClaim(policy.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
