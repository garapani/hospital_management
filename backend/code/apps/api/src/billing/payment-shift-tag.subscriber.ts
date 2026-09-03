import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { CashierShift } from './entities/cashier-shift.entity.js';
import { Payment } from './entities/payment.entity.js';

/**
 * Auto-tags a new `payments` row with the recording account's open `CashierShift`, if it has one
 * — additive, not a precondition: a payment recorded with no open shift is simply untagged
 * (`shiftId` stays null), matching the "shift tracking is optional" product decision. Wired like
 * `ChargeCaptureSubscriber` (registered on the main `DataSource` from `OnModuleInit`, filtered by
 * `tableName` rather than an entity import to avoid a module-boundary edge).
 *
 * Runs on `beforeInsert`, not `afterInsert` + a follow-up UPDATE: mutating `event.entity` here
 * lands the `shiftId` in the same INSERT statement TypeORM is about to generate, so there's no
 * second write and no window where the row briefly exists untagged.
 */
@Injectable()
export class PaymentShiftTagSubscriber implements EntitySubscriberInterface, OnModuleInit {
  private readonly logger = new Logger(PaymentShiftTagSubscriber.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this);
  }

  async beforeInsert(event: InsertEvent<Record<string, unknown>>): Promise<void> {
    if (event.metadata.tableName !== 'payments') {
      return;
    }
    const accountId = this.tenantContext.getAccountId();
    if (!accountId) {
      return;
    }

    try {
      const openShift = await event.manager
        .getRepository(CashierShift)
        .findOne({ where: { openedBy: accountId, status: 'Open' } });
      if (openShift && event.entity) {
        (event.entity as Partial<Payment>).shiftId = openShift.id;
      }
    } catch (error) {
      // Best-effort: a lookup failure here must never block recording the payment itself.
      this.logger.error(
        `Failed to resolve an open shift for account ${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
