import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Subscription, BillingCycle } from './entities/subscription.entity.js';
import { SubscriptionInvoice } from './entities/subscription-invoice.entity.js';
import { PACKAGE_CATALOG } from '../packages/package-catalog.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';

const CYCLE_MS: Record<BillingCycle, number> = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  annual: 365 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class SubscriptionBillingService {
  constructor(private readonly dataSource: DataSource) {}

  private get repository() {
    return this.dataSource.getRepository(Subscription);
  }

  private get invoiceRepository() {
    return this.dataSource.getRepository(SubscriptionInvoice);
  }

  private resolvePrice(packageCode: string, billingCycle: BillingCycle): number {
    const pkg = PACKAGE_CATALOG.find((p) => p.code === packageCode);
    if (!pkg) {
      throw new BadRequestException(`Unknown packageCode: ${packageCode}`);
    }
    return billingCycle === 'annual' ? pkg.priceAnnual : pkg.priceMonthly;
  }

  private async tenantRow(hospitalId: string): Promise<{ packageCode: string }> {
    if (hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is the platform tenant and cannot be billed`,
      );
    }
    const rows: { packageCode: string }[] = await this.dataSource.query(
      `SELECT "packageCode" FROM tenants WHERE "hospitalId" = $1`,
      [hospitalId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    return rows[0];
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

  /** Starts or updates a tenant's subscription: package comes from the tenant's current package,
   *  price is fixed from the catalog at subscribe time. A new subscription starts a fresh period. */
  async subscribe(
    tenantId: string,
    billingCycle: BillingCycle,
  ): Promise<Subscription> {
    const { packageCode } = await this.tenantRow(tenantId);
    const pricePerCycle = this.resolvePrice(packageCode, billingCycle);
    const now = Date.now();

    const existing = await this.getSubscription(tenantId);
    if (existing) {
      // Renewal/plan change: keep the current period, update the terms.
      existing.packageCode = packageCode;
      existing.billingCycle = billingCycle;
      existing.pricePerCycle = pricePerCycle;
      existing.status = 'active';
      return this.repository.save(existing);
    }

    return this.repository.save(
      this.repository.create({
        tenantId,
        packageCode,
        billingCycle,
        pricePerCycle,
        status: 'active',
        currentPeriodStart: new Date(now),
        currentPeriodEnd: new Date(now + CYCLE_MS[billingCycle]),
      }),
    );
  }

  async cancelSubscription(tenantId: string): Promise<Subscription> {
    const subscription = await this.getSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundException(`No active subscription for tenant ${tenantId}`);
    }
    subscription.status = 'canceled';
    return this.repository.save(subscription);
  }

  /** Issues an invoice for the subscription's current period. One open invoice per period
   *  (unique partial index) — re-issuing the same period is a 409. */
  async issueInvoice(tenantId: string): Promise<SubscriptionInvoice> {
    const subscription = await this.getSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundException(`No active subscription for tenant ${tenantId}`);
    }
    const existing = await this.invoiceRepository.findOne({
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

    return this.invoiceRepository.save(
      this.invoiceRepository.create({
        subscriptionId: subscription.id,
        tenantId,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
        amount: subscription.pricePerCycle,
        status: 'open',
        paidAt: null,
      }),
    );
  }

  /** Marks an invoice paid and advances the subscription to its next period (renewal). */
  async markInvoicePaid(invoiceId: string): Promise<SubscriptionInvoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await manager.getRepository(SubscriptionInvoice).findOne({
        where: { id: invoiceId },
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.status === 'paid') {
        return invoice;
      }
      invoice.status = 'paid';
      invoice.paidAt = new Date();
      await manager.getRepository(SubscriptionInvoice).save(invoice);

      const subscription = await manager.getRepository(Subscription).findOne({
        where: { id: invoice.subscriptionId },
      });
      if (subscription && subscription.status === 'active') {
        const start = invoice.periodEnd.getTime();
        subscription.currentPeriodStart = new Date(start);
        subscription.currentPeriodEnd = new Date(
          start + CYCLE_MS[subscription.billingCycle],
        );
        await manager.getRepository(Subscription).save(subscription);
      }
      return invoice;
    });
  }

  listInvoices(tenantId?: string): Promise<SubscriptionInvoice[]> {
    return this.invoiceRepository.find({
      where: tenantId ? { tenantId } : {},
      order: { issuedAt: 'DESC' },
    });
  }
}
