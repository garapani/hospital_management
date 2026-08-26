import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ObjectStorageService } from '@hospital/object-storage';
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

import { TenantsService } from '../tenants/tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';

describe('SubscriptionBillingService (integration)', () => {
  let ctx: TenantTestContext;
  let service: SubscriptionBillingService;
  let tenantsService: TenantsService;

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
    const packagesService = new PackagesService(ctx.dataSource);
    tenantsService = new TenantsService(
      ctx.dataSource,
      new TenantProvisioningService(ctx.dataSource),
      ctx.tenantConnection,
      ctx.tenantContext,
      packagesService,
      ctx.accountsService,
      new ObjectStorageService(),
    );
    service = new SubscriptionBillingService(ctx.dataSource, tenantsService);
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
    // P2: periods are calendar-sized now, not the old fixed 30-day constant — a monthly period
    // is one calendar month (length varies with the month), so assert cycle length, not ms.
    const monthsBetween = (start: Date, end: Date): number =>
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    expect(monthsBetween(sub.currentPeriodStart, sub.currentPeriodEnd)).toBe(1);
  });

  it('prices an annual subscription from the catalog and updates terms on re-subscribe', async () => {
    await provision(`${PREFIX}ent`, 'enterprise');
    const annual = await service.subscribe(`${PREFIX}ent`, 'annual');
    expect(annual.pricePerCycle).toBe(216000);
    // Calendar-sized: an annual period is twelve calendar months, not 365 fixed days.
    const monthsBetween = (start: Date, end: Date): number =>
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    expect(monthsBetween(annual.currentPeriodStart, annual.currentPeriodEnd)).toBe(12);

    const monthly = await service.subscribe(`${PREFIX}ent`, 'monthly');
    expect(monthly.pricePerCycle).toBe(19999);
    expect(monthly.billingCycle).toBe('monthly');
    // Re-subscribe keeps the same subscription row (same id).
    expect(monthly.id).toBe(annual.id);
    // 2.22 regression: a billingCycle switch must start a fresh period sized to the NEW cycle,
    // not keep the old (annual-length) period while pricePerCycle jumps to the monthly rate.
    expect(monthsBetween(monthly.currentPeriodStart, monthly.currentPeriodEnd)).toBe(1);
  });

  it('re-subscribing with the SAME billingCycle keeps the current period (not a reset)', async () => {
    await provision(`${PREFIX}same_cycle`, 'basic');
    const first = await service.subscribe(`${PREFIX}same_cycle`, 'monthly');

    const second = await service.subscribe(`${PREFIX}same_cycle`, 'monthly');
    expect(second.id).toBe(first.id);
    expect(second.currentPeriodStart.getTime()).toBe(first.currentPeriodStart.getTime());
    expect(second.currentPeriodEnd.getTime()).toBe(first.currentPeriodEnd.getTime());
  });

  it('rejects subscribing an unknown tenant or the platform tenant', async () => {
    await expect(service.subscribe('no_such_tenant', 'monthly')).rejects.toThrow(NotFoundException);
    await expect(service.subscribe('__platform', 'monthly')).rejects.toThrow(
      'reserved system tenant and cannot be billed',
    );
  });

  it('rejects operations on archived tenants but allows them on suspended tenants', async () => {
    const suspendedId = `${PREFIX}suspended`;
    const archivedId = `${PREFIX}archived`;
    await provision(suspendedId, 'basic');
    await provision(archivedId, 'basic');

    await ctx.dataSource.query(`UPDATE tenants SET status = 'suspended' WHERE "hospitalId" = $1`, [suspendedId]);
    await ctx.dataSource.query(`UPDATE tenants SET status = 'archived' WHERE "hospitalId" = $1`, [archivedId]);

    // Suspended should succeed
    const sub = await service.subscribe(suspendedId, 'monthly');
    expect(sub.tenantId).toBe(suspendedId);

    const invoice = await service.issueInvoice(suspendedId);
    await service.markInvoicePaid(invoice.id);
    const canceled = await service.cancelSubscription(suspendedId);
    expect(canceled.status).toBe('canceled');

    // Archived should fail for subscribe
    await expect(service.subscribe(archivedId, 'monthly')).rejects.toThrow(/must have status active, suspended/);

    // Let's create a subscription via DB for the archived tenant to test issueInvoice and cancelSubscription
    await ctx.dataSource.query(
      `INSERT INTO subscriptions ("tenantId", "packageCode", "billingCycle", "pricePerCycle",
                                   "currentPeriodStart", "currentPeriodEnd", "status")
       VALUES ($1, 'basic', 'monthly', 1000, now(), now() + interval '30 days', 'active')`,
      [archivedId],
    );

    await expect(service.issueInvoice(archivedId)).rejects.toThrow(/must have status active, suspended/);
    await expect(service.cancelSubscription(archivedId)).rejects.toThrow(/must have status active, suspended/);

    // markInvoicePaid: create an open invoice directly (issueInvoice itself is already blocked
    // above), then confirm marking it paid is blocked too — this is the renewal mechanism, not a
    // read, so it must not be reachable for an archived (or purged) tenant.
    const [archivedInvoice] = await ctx.dataSource.query(
      `INSERT INTO subscription_invoices ("subscriptionId", "tenantId", "periodStart", "periodEnd", amount, status)
       SELECT id, "tenantId", "currentPeriodStart", "currentPeriodEnd", "pricePerCycle", 'open'
       FROM subscriptions WHERE "tenantId" = $1 RETURNING id`,
      [archivedId],
    );
    await expect(service.markInvoicePaid(archivedInvoice.id)).rejects.toThrow(
      /must have status active, suspended/,
    );
  });

  it('2.21: rejects an unrecognized billingCycle at the service layer instead of persisting a corrupted row', async () => {
    await provision(`${PREFIX}bad_cycle`, 'basic');
    await expect(
      service.subscribe(`${PREFIX}bad_cycle`, 'weekly' as unknown as 'monthly'),
    ).rejects.toThrow(BadRequestException);

    const sub = await service.getSubscription(`${PREFIX}bad_cycle`);
    expect(sub).toBeNull();
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

  it('stamps the vendor invoice with a number and the platform GST split', async () => {
    await provision(`${PREFIX}invnum`, 'basic');
    await service.subscribe(`${PREFIX}invnum`, 'monthly');

    const invoice = await service.issueInvoice(`${PREFIX}invnum`);
    // P2: the vendor's own invoices previously had no invoice number, tax, or GST fields.
    expect(invoice.invoiceNumber).toMatch(/^SI-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}$/);
    expect(invoice.taxPercent).toBe(18);
    expect(invoice.taxAmount).toBe(Math.round((invoice.amount * 18) / 100 * 100) / 100);

    // The number is derived from (subscriptionId, periodStart) — unique per period.
    await expect(service.issueInvoice(`${PREFIX}invnum`)).rejects.toThrow(ConflictException);
  });

  it('refuses to re-issue an already-paid period even after the period is reset', async () => {
    // P3: the "one invoice per period" index used to cover only OPEN invoices — after the period
    // was paid and the subscription's currentPeriodStart moved on, nothing stopped a later path
    // from billing the same period again. Prove the widened index: reset the subscription's
    // current period back onto a PAID invoice's period and issue — must 409.
    await provision(`${PREFIX}reissue`, 'basic');
    await service.subscribe(`${PREFIX}reissue`, 'monthly');
    const invoice = await service.issueInvoice(`${PREFIX}reissue`);
    await service.markInvoicePaid(invoice.id);

    await ctx.dataSource.query(
      `UPDATE subscriptions SET "currentPeriodStart" = $1, "currentPeriodEnd" = $2 WHERE "tenantId" = $3`,
      [invoice.periodStart, invoice.periodEnd, `${PREFIX}reissue`],
    );

    await expect(service.issueInvoice(`${PREFIX}reissue`)).rejects.toThrow(ConflictException);
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

  it('marking paid advances the period by the invoice\'s own cycle, not a billing cycle changed afterward', async () => {
    await provision(`${PREFIX}cycle_switch`, 'basic');
    await service.subscribe(`${PREFIX}cycle_switch`, 'monthly');
    const invoice = await service.issueInvoice(`${PREFIX}cycle_switch`);

    // Cycle changed to annual before the monthly invoice above is paid.
    await service.subscribe(`${PREFIX}cycle_switch`, 'annual');

    const paid = await service.markInvoicePaid(invoice.id);
    const sub = await service.getSubscription(`${PREFIX}cycle_switch`);

    // The granted period matches what was actually invoiced/paid (one calendar month), not the
    // subscription's current (annual) cycle. Calendar months, not ms: month-end periods make
    // ms-lengths differ across months (the old fixed-millisecond arithmetic was the drift P2
    // fixed), so the assertion is on cycle length, not elapsed ms.
    const monthsBetween = (start: Date, end: Date): number =>
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    expect(monthsBetween(invoice.periodStart, invoice.periodEnd)).toBe(1);
    expect(monthsBetween(sub!.currentPeriodStart, sub!.currentPeriodEnd)).toBe(1);
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

  it('2.19: concurrent cancelSubscription + markInvoicePaid never resurrects a canceled subscription', async () => {
    await provision(`${PREFIX}race_cancel`, 'basic');
    await service.subscribe(`${PREFIX}race_cancel`, 'monthly');
    const invoice = await service.issueInvoice(`${PREFIX}race_cancel`);

    await Promise.allSettled([
      service.cancelSubscription(`${PREFIX}race_cancel`),
      service.markInvoicePaid(invoice.id),
    ]);

    // Whichever operation's tenant-scoped lock wins the race, the end state must be consistent:
    // cancelSubscription always wins the write (it unconditionally sets 'canceled', and
    // markInvoicePaid only touches the subscription if it re-reads 'active' after acquiring the
    // lock) — so the subscription must never come back as 'active' regardless of interleave
    // order. Before the fix, a markInvoicePaid that read the subscription before cancel's commit
    // but wrote after it would silently overwrite the cancellation back to 'active'.
    const sub = await service.getSubscription(`${PREFIX}race_cancel`);
    expect(sub).toBeNull();

    const invoices = await service.listInvoices(`${PREFIX}race_cancel`);
    expect(invoices.find((i) => i.id === invoice.id)?.status).toBe('paid');
  });
});
