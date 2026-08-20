import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PayrollService } from './payroll.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('PayrollService (integration)', () => {
  let ctx: TenantTestContext;
  let payrollService: PayrollService;

  const STAFF_ID = '00000000-0000-0000-0000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';
  const SPOOFED_ACTOR = '00000000-0000-0000-0000-0000000000ff';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'payroll' });
    payrollService = new PayrollService(ctx.tenantConnection, ctx.tenantContext);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'payroll-test' },
      work,
    );
  }

  let seq = 0;
  /** Raw-inserts an employee straight into the tenant schema (the spec needs no employee service). */
  async function insertEmployee(overrides: { monthlyBasicSalary?: number; isActive?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO employees (id, "employeeCode", "firstName", "lastName", "joinDate", "monthlyBasicSalary", "isActive")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            `PAY-${++seq}`,
            'Payroll',
            'Test',
            '2024-01-01',
            overrides.monthlyBasicSalary ?? 0,
            overrides.isActive ?? true,
          ],
        ),
      ),
    );
    return id;
  }

  it('computes exact payslip amounts from monthlyBasicSalary (2dp money math)', async () => {
    const empA = await insertEmployee({ monthlyBasicSalary: 50000 });
    const empB = await insertEmployee({ monthlyBasicSalary: 25000 });
    await insertEmployee({ monthlyBasicSalary: 99999, isActive: false }); // inactive — skipped

    const payslips = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(1, 2026, {
        allowancePercent: 10,
        deductionPercent: 5,
        processedBy: STAFF_ID,
      }),
    );

    expect(payslips).toHaveLength(2);
    const byEmployee = new Map(payslips.map((p) => [p.employeeId, p]));
    const a = byEmployee.get(empA)!;
    expect(a.periodMonth).toBe(1);
    expect(a.periodYear).toBe(2026);
    expect(a.basicAmount).toBe(50000);
    expect(a.allowanceAmount).toBe(5000);
    expect(a.grossAmount).toBe(55000);
    expect(a.deductionAmount).toBe(2750);
    expect(a.netAmount).toBe(52250);
    expect(a.status).toBe('Draft');
    expect(a.paidAt).toBeNull();
    expect(a.notes).toBeNull();

    const b = byEmployee.get(empB)!;
    expect(b.basicAmount).toBe(25000);
    expect(b.allowanceAmount).toBe(2500);
    expect(b.grossAmount).toBe(27500);
    expect(b.deductionAmount).toBe(1375);
    expect(b.netAmount).toBe(26125);
  });

  it('rounds fractional money to 2 decimals', async () => {
    const emp = await insertEmployee({ monthlyBasicSalary: 33333.33 });
    const payslips = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(2, 2026, {
        allowancePercent: 10,
        deductionPercent: 5,
        processedBy: STAFF_ID,
      }),
    );
    const payslip = payslips.find((p) => p.employeeId === emp)!;
    // allowance = 3333.333 -> 3333.33; gross = 36666.66; deduction = 1833.333 -> 1833.33; net = 34833.33.
    expect(payslip.allowanceAmount).toBe(3333.33);
    expect(payslip.grossAmount).toBe(36666.66);
    expect(payslip.deductionAmount).toBe(1833.33);
    expect(payslip.netAmount).toBe(34833.33);
  });

  it('is idempotent — re-running the same month/year skips employees that already have payslips', async () => {
    const emp = await insertEmployee({ monthlyBasicSalary: 40000 });

    const first = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(3, 2026, { processedBy: STAFF_ID }),
    );
    expect(first.some((p) => p.employeeId === emp)).toBe(true);

    const second = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(3, 2026, { processedBy: STAFF_ID }),
    );
    // Nothing new is created: every active employee already has a payslip for (3, 2026).
    expect(second).toHaveLength(0);

    const listing = await ctx.inTenant(() => payrollService.listPayslips({ employeeId: emp, month: 3, year: 2026 }));
    expect(listing.data).toHaveLength(1);
    expect(listing.meta.total).toBe(1);

    // A different period is still generated for the employee.
    const april = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(4, 2026, { processedBy: STAFF_ID }),
    );
    const aprilForEmp = april.filter((p) => p.employeeId === emp);
    expect(aprilForEmp).toHaveLength(1);
    expect(aprilForEmp[0].periodMonth).toBe(4);
  });

  it('marks a Draft payslip Paid and rejects double-pay with ConflictException', async () => {
    await insertEmployee({ monthlyBasicSalary: 30000 });
    const [payslip] = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(5, 2026, { processedBy: STAFF_ID }),
    );

    const paid = await withActor(() => payrollService.markPaid(payslip.id));
    expect(paid.status).toBe('Paid');
    expect(paid.paidAt).not.toBeNull();
    expect(paid.processedBy).toBe(AUTHENTICATED_ACCOUNT);

    await expect(withActor(() => payrollService.markPaid(payslip.id))).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException for unknown payslips', async () => {
    await expect(ctx.inTenant(() => payrollService.getPayslip(randomUUID()))).rejects.toThrow(NotFoundException);
    await expect(ctx.inTenant(() => payrollService.markPaid(randomUUID()))).rejects.toThrow(NotFoundException);
  });

  it('validates month/year and percentage inputs', async () => {
    await expect(ctx.inTenant(() => payrollService.runMonthlyPayroll(0, 2026))).rejects.toThrow(BadRequestException);
    await expect(ctx.inTenant(() => payrollService.runMonthlyPayroll(13, 2026))).rejects.toThrow(BadRequestException);
    await expect(ctx.inTenant(() => payrollService.runMonthlyPayroll(1.5, 2026))).rejects.toThrow(BadRequestException);
    await expect(ctx.inTenant(() => payrollService.runMonthlyPayroll(1, 1899))).rejects.toThrow(BadRequestException);
    await expect(ctx.inTenant(() => payrollService.runMonthlyPayroll(1, 10000))).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => payrollService.runMonthlyPayroll(1, 2026, { allowancePercent: -1 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => payrollService.runMonthlyPayroll(1, 2026, { deductionPercent: -5 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => payrollService.runMonthlyPayroll(1, 2026, { allowancePercent: Number.NaN })),
    ).rejects.toThrow(BadRequestException);
  });

  it('derives processedBy from the authenticated principal (§25)', async () => {
    await insertEmployee({ monthlyBasicSalary: 20000 });
    const [payslip] = await withActor(() =>
      payrollService.runMonthlyPayroll(6, 2026, { processedBy: SPOOFED_ACTOR }),
    );
    expect(payslip.processedBy).toBe(AUTHENTICATED_ACCOUNT);

    const paid = await withActor(() => payrollService.markPaid(payslip.id, SPOOFED_ACTOR));
    expect(paid.processedBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('falls back to the caller-supplied processedBy when no authenticated principal is present', async () => {
    await insertEmployee({ monthlyBasicSalary: 20000 });
    const [payslip] = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(7, 2026, { processedBy: SPOOFED_ACTOR }),
    );
    expect(payslip.processedBy).toBe(SPOOFED_ACTOR);

    const paid = await ctx.inTenant(() => payrollService.markPaid(payslip.id, SPOOFED_ACTOR));
    expect(paid.processedBy).toBe(SPOOFED_ACTOR);
  });

  it('lists payslips with filters and pagination', async () => {
    const emp = await insertEmployee({ monthlyBasicSalary: 15000 });
    await ctx.inTenant(() => payrollService.runMonthlyPayroll(8, 2026, { processedBy: STAFF_ID }));
    const paid = await ctx.inTenant(async () => {
      const listing = await payrollService.listPayslips({ month: 8, year: 2026 });
      return payrollService.markPaid(listing.data[0].id);
    });

    const all = await ctx.inTenant(() => payrollService.listPayslips({}));
    expect(all.data.length).toBeGreaterThanOrEqual(1);
    expect(all.meta.total).toBeGreaterThanOrEqual(1);

    const byEmployee = await ctx.inTenant(() => payrollService.listPayslips({ employeeId: emp }));
    expect(byEmployee.data).toHaveLength(1);
    expect(byEmployee.data[0].employeeId).toBe(emp);

    const byMonthYear = await ctx.inTenant(() => payrollService.listPayslips({ month: 8, year: 2026 }));
    expect(byMonthYear.data.length).toBeGreaterThanOrEqual(1);
    expect(byMonthYear.data.every((p) => p.periodMonth === 8 && p.periodYear === 2026)).toBe(true);

    const draftOnly = await ctx.inTenant(() =>
      payrollService.listPayslips({ month: 8, year: 2026, status: 'Draft' }),
    );
    const paidOnly = await ctx.inTenant(() =>
      payrollService.listPayslips({ month: 8, year: 2026, status: 'Paid' }),
    );
    expect(paidOnly.data).toHaveLength(1);
    expect(paidOnly.data[0].id).toBe(paid.id);
    expect(draftOnly.data.some((p) => p.id === paid.id)).toBe(false);
  });

  it('enforces tenant isolation', async () => {
    await insertEmployee({ monthlyBasicSalary: 10000 });
    const [payslip] = await ctx.inTenant(() =>
      payrollService.runMonthlyPayroll(9, 2026, { processedBy: STAFF_ID }),
    );

    const tenantB = await ctx.createTenant();
    const emptyRun = await tenantB.inTenant(() =>
      payrollService.runMonthlyPayroll(9, 2026, { processedBy: STAFF_ID }),
    );
    expect(emptyRun).toHaveLength(0);

    const listing = await tenantB.inTenant(() => payrollService.listPayslips({}));
    expect(listing.data).not.toContainEqual(expect.objectContaining({ id: payslip.id }));

    await expect(tenantB.inTenant(() => payrollService.getPayslip(payslip.id))).rejects.toThrow(NotFoundException);
  });
});
