import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Subscription, BillingCycle } from './entities/subscription.entity.js';
import { SubscriptionInvoice } from './entities/subscription-invoice.entity.js';
import { PACKAGE_CATALOG } from '../packages/package-catalog.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { withAdvisoryLock } from '../database/advisory-lock.util.js';

const VALID_BILLING_CYCLES = new Set<BillingCycle>(['monthly', 'annual']);

/** Platform GST rate applied to the vendor's own subscription invoices (CGST+SGST at the
 *  standard rate; the platform owner sets this — see Dev Standards §89). */
const PLATFORM_GST_PERCENT = 18;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calendar-month arithmetic, not fixed-millisecond: "monthly"/"annual" must track real calendar
 * months/years (a monthly period from Jan 31 ends Feb 28, not Feb 1) — the old 30/365-day
 * constants drifted against the calendar (code-review-findings-2026-08-25 platform-billing P2).
 * The day-of-month is clamped to the target month's last day when the source day doesn't exist.
 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

/** Whole calendar months between two dates (0 when the end is before the start). */
function monthsBetween(start: Date, end: Date): number {
  return Math.max(
    0,
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()),
  );
}

@Injectable()
export class SubscriptionBillingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantsService: TenantsService,
  ) {}

  private get repository() {
    return this.dataSource.getRepository(Subscription);
  }

  private get invoiceRepository() {
    return this.dataSource.getRepository(SubscriptionInvoice);
  }

  private resolvePrice(packageCode: string, billingCycle: BillingCycle): number {
    if (!VALID_BILLING_CYCLES.has(billingCycle)) {
      throw new BadRequestException(`Unknown billingCycle: ${billingCycle}`);
    }
    const pkg = PACKAGE_CATALOG.find((p) => p.code === packageCode);
    if (!pkg) {
      throw new BadRequestException(`Unknown packageCode: ${packageCode}`);
    }
    return billingCycle === 'annual' ? pkg.priceAnnual : pkg.priceMonthly;
  }

  /** Resolves the tenant's current package code via the shared lookup. */
  private async resolvePackageCode(hospitalId: string): Promise<string> {
    const tenant = await this.tenantsService.assertValidHospitalTenant(hospitalId, ['active', 'suspended'], 'be billed');
    return tenant.packageCode;
  }

  async getSubscription(tenantId: string): Promise<Subscription | null> {
    return this.repository.findOne({
      where: { tenantId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
  }

  listSubscriptions(): Promise<Subscription[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  private lockTenantBilling(manager: EntityManager, tenantId: string): Promise<void> {
    return withAdvisoryLock(manager, `platform_billing:${tenantId}`);
  }

  /** Starts or updates a tenant's subscription: package comes from the tenant's current package,
   *  price is fixed from the catalog at subscribe time. A new subscription starts a fresh period. */
  async subscribe(
    tenantId: string,
    billingCycle: BillingCycle,
  ): Promise<Subscription> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockTenantBilling(manager, tenantId);
      const packageCode = await this.resolvePackageCode(tenantId);
      const pricePerCycle = this.resolvePrice(packageCode, billingCycle);
      const now = Date.now();

      const existing = await manager.getRepository(Subscription).findOne({
        where: { tenantId, status: 'active' },
        order: { createdAt: 'DESC' },
      });
      // Same-cycle plan change (e.g. re-confirming/package swap with billingCycle unchanged)
      // reuses the existing row and keeps its current period; a first-time subscribe or an
      // actual billingCycle switch starts a fresh period sized to the new cycle. Without this,
      // switching monthly->annual mid-period left the 30-day period untouched while pricePerCycle
      // jumped to the annual rate — issueInvoice billed the full annual price every 30 days
      // (2.22). The terms themselves (package/cycle/price/status) are the same shape either way,
      // set once here rather than twice.
      const target = existing ?? manager.getRepository(Subscription).create({ tenantId });
      if (!existing || existing.billingCycle !== billingCycle) {
        target.currentPeriodStart = new Date(now);
        target.currentPeriodEnd = addMonths(target.currentPeriodStart, billingCycle === 'annual' ? 12 : 1);
      }
      target.packageCode = packageCode;
      target.billingCycle = billingCycle;
      target.pricePerCycle = pricePerCycle;
      target.status = 'active';
      return manager.getRepository(Subscription).save(target);
    });
  }

  async cancelSubscription(tenantId: string): Promise<Subscription> {
    await this.tenantsService.assertValidHospitalTenant(tenantId, ['active', 'suspended'], 'be modified');
    return this.dataSource.transaction(async (manager) => {
      await this.lockTenantBilling(manager, tenantId);
      const subscription = await manager.getRepository(Subscription).findOne({
        where: { tenantId, status: 'active' },
        order: { createdAt: 'DESC' },
      });
      if (!subscription) {
        throw new NotFoundException(`No active subscription for tenant ${tenantId}`);
      }
      subscription.status = 'canceled';
      return manager.getRepository(Subscription).save(subscription);
    });
  }

  /**
   * Issues an invoice for the subscription's current period. One invoice per period — guarded by
   * the per-tenant lock above plus a unique index on (subscriptionId, periodStart) covering ALL
   * statuses (the old index was open-only, so a re-subscribed tenant could double-bill an
   * already-paid period; code-review-findings-2026-08-25 P3); re-issuing the same period is a 409.
   */
  async issueInvoice(tenantId: string): Promise<SubscriptionInvoice> {
    await this.tenantsService.assertValidHospitalTenant(tenantId, ['active', 'suspended'], 'be billed');
    return this.dataSource.transaction(async (manager) => {
      await this.lockTenantBilling(manager, tenantId);
      const subscription = await manager.getRepository(Subscription).findOne({
        where: { tenantId, status: 'active' },
        order: { createdAt: 'DESC' },
      });
      if (!subscription) {
        throw new NotFoundException(`No active subscription for tenant ${tenantId}`);
      }
      const existing = await manager.getRepository(SubscriptionInvoice).findOne({
        where: {
          subscriptionId: subscription.id,
          periodStart: subscription.currentPeriodStart,
        },
      });
      if (existing) {
        throw new ConflictException(
          `An invoice already exists for this period (${existing.amount} ₹, ${existing.status})`,
        );
      }

      // The vendor's own invoice carries a number plus the platform GST split — previously the
      // platform billed itself with no invoice number, tax, or GST fields
      // (code-review-findings-2026-08-25 P2). The number is derived deterministically from
      // (subscriptionId, periodStart), which the period unique index makes globally unique.
      const invoiceNumber = `SI-${subscription.id.slice(0, 8)}-${subscription.currentPeriodStart
        .toISOString()
        .slice(0, 10)}`;
      const taxAmount = roundMoney((subscription.pricePerCycle * PLATFORM_GST_PERCENT) / 100);

      return manager.getRepository(SubscriptionInvoice).save(
        manager.getRepository(SubscriptionInvoice).create({
          subscriptionId: subscription.id,
          tenantId,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
          amount: subscription.pricePerCycle,
          invoiceNumber,
          taxPercent: PLATFORM_GST_PERCENT,
          taxAmount,
          status: 'open',
          paidAt: null,
        }),
      );
    });
  }

  /** Marks an invoice paid and advances the subscription to its next period (renewal). */
  async markInvoicePaid(invoiceId: string): Promise<SubscriptionInvoice> {
    return this.dataSource.transaction(async (manager) => {
      // Invoice-scoped lock first: serializes concurrent mark-paid calls on the very same invoice
      // (e.g. a double-clicked "Mark Paid" button) before we've even read it.
      await withAdvisoryLock(manager, `platform_billing_invoice:${invoiceId}`);
      const invoice = await manager.getRepository(SubscriptionInvoice).findOne({
        where: { id: invoiceId },
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.status === 'paid') {
        return invoice;
      }

      // markInvoicePaid is the renewal mechanism (it advances the subscription's period below) —
      // unlike getSubscription/listInvoices (read-only, correctly ungated), this mutates state and
      // must not be reachable for a tenant that shouldn't be billed. purgeTenant deliberately
      // preserves subscriptions/subscription_invoices (2.20), so without this guard a purged
      // tenant's still-open invoice could be marked paid and its subscription silently renewed.
      await this.tenantsService.assertValidHospitalTenant(invoice.tenantId, ['active', 'suspended'], 'be billed');

      // Also take the tenant-scoped lock subscribe/cancelSubscription/issueInvoice use. This
      // method reads-then-writes the Subscription row (below) via a full-entity save(), same as
      // those methods — without this lock, a concurrent cancelSubscription could commit between
      // our read and write, and our stale in-memory copy would silently overwrite the
      // cancellation back to 'active' when saved (2.19). No deadlock risk: this is the only
      // method that ever holds both locks at once, always in this same order.
      await this.lockTenantBilling(manager, invoice.tenantId);

      invoice.status = 'paid';
      invoice.paidAt = new Date();
      await manager.getRepository(SubscriptionInvoice).save(invoice);

      // Re-read after acquiring the tenant lock, not the copy fetched before it — a concurrent
      // cancelSubscription may have committed while we were waiting on the lock, and this must
      // see that result rather than a pre-lock snapshot.
      const subscription = await manager.getRepository(Subscription).findOne({
        where: { id: invoice.subscriptionId },
      });
      if (subscription && subscription.status === 'active') {
        // Advance by the invoice's OWN cycle length in calendar months, not the subscription's
        // current billingCycle — subscribe() can change the cycle in place between an invoice
        // being issued and paid, and the period granted must match what was actually
        // invoiced/paid, not whatever cycle the subscription happens to carry now. Calendar math
        // keeps renewal on real months/years instead of drifting (code-review-findings-2026-08-25
        // platform-billing P2).
        const periodMonths = monthsBetween(invoice.periodStart, invoice.periodEnd);
        subscription.currentPeriodStart = new Date(invoice.periodEnd.getTime());
        subscription.currentPeriodEnd = addMonths(invoice.periodEnd, periodMonths);
        await manager.getRepository(Subscription).save(subscription);
      }
      return invoice;
    });
  }

  listInvoices(tenantId: string): Promise<SubscriptionInvoice[]> {
    return this.invoiceRepository.find({
      where: { tenantId },
      order: { issuedAt: 'DESC' },
    });
  }
}
