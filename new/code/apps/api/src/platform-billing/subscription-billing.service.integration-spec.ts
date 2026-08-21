import { ConflictException, NotFoundException } from '@nestjs/common';
import { SubscriptionBillingService } from './subscription-billing.service.js';
import { PackagesService } from '../packages/packages.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// subscriptions/subscription_invoices are shared platform tables — prefix + clean up like the
// other shared-table specs.
const PREFIX = 'test_billing_tenant_';

describe('SubscriptionBillingService (integration)', () => {
  let ctx: TenantTestContext;
  let service: SubscriptionBillingService;

  const cleanup = async () => {
    await ctx.dataSource.query(`DELETE FROM subscription_invoices WHERE "tenantId" LIKE '${PREFIX}%'`);
    await ctx.dataSource.query(`DELETE FROM subscriptions WHERE "tenantId" LIKE '${PREFIX}%'`);
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE '${PREFIX}%'`);
  };

  const provision = (hospitalId: string, packageCode: string) =>
    ctx.dataSource.query(
      `INSERT INTO tenants ("hospitalId", "hospitalName", "status", "packageCode", "createdBy", "activatedAt")
       VALUES ($1, 'Billing Test Hospital', 'active', $2, 'billing-spec', NOW())`,
      [hospitalId, packageCode],
    );

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'billing_svc' });
    service = new SubscriptionBillingService(ctx.dataSource, new PackagesService(ctx.dataSource));
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTenantTestContext(ctx);
  });

  it('subscribes a tenant with its package price and a fresh period', async () => {
    await provision(`${PREFIX}basic`, 'basic');
    const sub = await service.subscribe(`${PREFIX}basic`, 'monthly');

    expect(sub.tenantId).toBe(`${PREFIX}basic`);
    expect(sub.packageCode).toBe('basic');
    expect(sub.billingCycle).toBe('monthly');
    expect(sub.pricePerCycle).toBe(4999);
    expect(sub.status).toBe('active');
    expect(sub.currentPeriodStart.getTime()).toBeLessThanOrEqual(Date.now());
    expect(sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
  });

  it('prices an annual subscription from the catalog and updates terms on re-subscribe', async () => {
    await provision(`${PREFIX}ent`, 'enterprise');
    const annual = await service.subscribe(`${PREFIX}ent`, 'annual');
    expect(annual.pricePerCycle).toBe(216000);

    const monthly = await service.subscribe(`${PREFIX}ent`, 'monthly');
    expect(monthly.pricePerCycle).toBe(19999);
    expect(monthly.billingCycle).toBe('monthly');
    // Re-subscribe keeps the same subscription row (same id).
    expect(monthly.id).toBe(annual.id);
  });

  it('rejects subscribing an unknown tenant or the platform tenant', async () => {
    await expect(service.subscribe('no_such_tenant', 'monthly')).rejects.toThrow(NotFoundException);
    await expect(service.subscribe('__platform', 'monthly')).rejects.toThrow(
      'platform tenant and cannot be billed',
    );
  });

  it('issues an invoice for the current period and refuses a duplicate open invoice', async () => {
    await provision(`${PREFIX}inv`, 'standard');
    const sub = await service.subscribe(`${PREFIX}inv`, 'annual');

    const invoice = await service.issueInvoice(`${PREFIX}inv`);
    expect(invoice.tenantId).toBe(`${PREFIX}inv`);
    expect(invoice.amount).toBe(108000);
    expect(invoice.status).toBe('open');
    expect(invoice.periodStart).toEqual(sub.currentPeriodStart);
    expect(invoice.periodEnd).toEqual(sub.currentPeriodEnd);

    await expect(service.issueInvoice(`${PREFIX}inv`)).rejects.toThrow(ConflictException);
  });

  it('rejects issuing an invoice with no active subscription', async () => {
    await provision(`${PREFIX}nosub`, 'basic');
    await expect(service.issueInvoice(`${PREFIX}nosub`)).rejects.toThrow(NotFoundException);
  });

  it('marking paid advances the subscription to the next period', async () => {
    await provision(`${PREFIX}paid`, 'basic');
    await service.subscribe(`${PREFIX}paid`, 'monthly');
    const invoice = await service.issueInvoice(`${PREFIX}paid`);

    const paid = await service.markInvoicePaid(invoice.id);
    expect(paid.status).toBe('paid');
    expect(paid.paidAt).not.toBeNull();

    const sub = await service.getSubscription(`${PREFIX}paid`);
    expect(sub?.currentPeriodStart).toEqual(paid.periodEnd);

    // The next period can now be invoiced.
    const next = await service.issueInvoice(`${PREFIX}paid`);
    expect(next.periodStart).toEqual(paid.periodEnd);
  });

  it('cancels an active subscription; issuing afterwards is refused', async () => {
    await provision(`${PREFIX}cancel`, 'basic');
    await service.subscribe(`${PREFIX}cancel`, 'monthly');
    const canceled = await service.cancelSubscription(`${PREFIX}cancel`);
    expect(canceled.status).toBe('canceled');

    await expect(service.issueInvoice(`${PREFIX}cancel`)).rejects.toThrow(NotFoundException);
  });

  it('returns 404 when marking an unknown invoice paid', async () => {
    await expect(
      service.markInvoicePaid('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });

  it('concurrent issueInvoice calls for the same tenant/period: exactly one succeeds with a 409, not an unhandled DB error', async () => {
    await provision(`${PREFIX}race_invoice`, 'basic');
    await service.subscribe(`${PREFIX}race_invoice`, 'monthly');

    const results = await Promise.allSettled([
      service.issueInvoice(`${PREFIX}race_invoice`),
      service.issueInvoice(`${PREFIX}race_invoice`),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
  });

  it('marking paid advances the period by the invoice\'s own length, not a billing cycle changed afterward', async () => {
    await provision(`${PREFIX}cycle_switch`, 'basic');
    await service.subscribe(`${PREFIX}cycle_switch`, 'monthly');
    const invoice = await service.issueInvoice(`${PREFIX}cycle_switch`);
    const monthlyPeriodMs = invoice.periodEnd.getTime() - invoice.periodStart.getTime();

    // Cycle changed to annual before the monthly invoice above is paid.
    await service.subscribe(`${PREFIX}cycle_switch`, 'annual');

    const paid = await service.markInvoicePaid(invoice.id);
    const sub = await service.getSubscription(`${PREFIX}cycle_switch`);

    // The granted period matches what was actually invoiced/paid (monthly), not the
    // subscription's current (annual) cycle.
    expect(sub!.currentPeriodEnd.getTime() - sub!.currentPeriodStart.getTime()).toBe(
      monthlyPeriodMs,
    );
    expect(sub!.currentPeriodStart).toEqual(paid.periodEnd);
  });

  it('concurrent markInvoicePaid calls on the same invoice are idempotent (paid exactly once)', async () => {
    await provision(`${PREFIX}race_paid`, 'basic');
    await service.subscribe(`${PREFIX}race_paid`, 'monthly');
    const invoice = await service.issueInvoice(`${PREFIX}race_paid`);

    const [first, second] = await Promise.all([
      service.markInvoicePaid(invoice.id),
      service.markInvoicePaid(invoice.id),
    ]);

    expect(first.status).toBe('paid');
    expect(second.status).toBe('paid');
    expect(first.paidAt).toEqual(second.paidAt);
  });
});
