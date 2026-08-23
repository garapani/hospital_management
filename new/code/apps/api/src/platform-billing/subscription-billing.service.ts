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

const CYCLE_MS: Record<BillingCycle, number> = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  annual: 365 * 24 * 60 * 60 * 1000,
};

const VALID_BILLING_CYCLES = new Set<BillingCycle>(['monthly', 'annual']);

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

  /** Resolves the tenant's current package code via the shared `PackagesService` lookup, rather
   *  than a second hand-rolled query against `tenants` — one source of truth for "how do you read
   *  a tenant's package code" so the two never drift. */
  private async tenantRow(hospitalId: string): Promise<{ packageCode: string }> {
    const tenant = await this.tenantsService.assertValidHospitalTenant(hospitalId, ['active', 'suspended'], 'be billed');
    return { packageCode: tenant.packageCode };
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

  // Serializes subscribe/cancel/issue-invoice for one tenant: the find-then-write shape each of
  // those methods uses (e.g. "no active subscription yet, so create one") is not otherwise
  // race-safe — two concurrent calls could both see the same pre-write state and both act on it.
  // Transaction-scoped (released on commit/rollback), same pattern as billing's charge-capture
  // lock (`invoices.service.ts`) — serializes only this tenant's billing ops, needs no schema
  // change.
  private lockTenantBilling(manager: EntityManager, tenantId: string): Promise<unknown> {
    return manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `platform_billing:${tenantId}`,
    ]);
  }

  /** Starts or updates a tenant's subscription: package comes from the tenant's current package,
   *  price is fixed from the catalog at subscribe time. A new subscription starts a fresh period. */
  async subscribe(
    tenantId: string,
    billingCycle: BillingCycle,
  ): Promise<Subscription> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockTenantBilling(manager, tenantId);
      const { packageCode } = await this.tenantRow(tenantId);
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
        target.currentPeriodEnd = new Date(now + CYCLE_MS[billingCycle]);
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

  /** Issues an invoice for the subscription's current period. One open invoice per period —
   *  guarded by the per-tenant lock above plus a unique partial index as a DB-level backstop;
   *  re-issuing the same period is a 409. */
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
          status: 'open',
        },
      });
      if (existing) {
        throw new ConflictException(
          `An open invoice already exists for this period (${existing.amount} ₹)`,
        );
      }

      return manager.getRepository(SubscriptionInvoice).save(
        manager.getRepository(SubscriptionInvoice).create({
          subscriptionId: subscription.id,
          tenantId,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
          amount: subscription.pricePerCycle,
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
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `platform_billing_invoice:${invoiceId}`,
      ]);
      const invoice = await manager.getRepository(SubscriptionInvoice).findOne({
        where: { id: invoiceId },
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.status === 'paid') {
        return invoice;
      }

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
        // Advance by the invoice's OWN period length, not the subscription's current
        // billingCycle — subscribe() can change the cycle in place between an invoice being
        // issued and paid, and the period granted must match what was actually invoiced/paid,
        // not whatever cycle the subscription happens to carry now.
        const periodLengthMs = invoice.periodEnd.getTime() - invoice.periodStart.getTime();
        subscription.currentPeriodStart = new Date(invoice.periodEnd.getTime());
        subscription.currentPeriodEnd = new Date(
          invoice.periodEnd.getTime() + periodLengthMs,
        );
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
