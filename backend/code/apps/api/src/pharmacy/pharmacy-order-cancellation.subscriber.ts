import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { PharmacyDispensing } from './entities/pharmacy-dispensing.entity.js';

/**
 * Cascades an order-item cancellation onto any still-live Pharmacy dispensing riding on it. See
 * `LabOrderCancellationSubscriber` for the full rationale — same pattern, same
 * code-review-findings-2026-08-25 orders P2. Only `Pending` is non-terminal here (matching
 * `PharmacyDispensingService.cancel`'s own guard) — once a dispensing reaches `Dispensed`, stock has
 * already been decremented; reversing it is `PharmacyDispensingService.reverseDispensing()`, a
 * deliberate staff action, not something a cancelled order item should trigger automatically.
 */
@Injectable()
export class PharmacyOrderCancellationSubscriber
  implements EntitySubscriberInterface<OrderItem>, OnModuleInit
{
  constructor(private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this);
  }

  listenTo(): typeof OrderItem {
    return OrderItem;
  }

  async afterUpdate(event: UpdateEvent<OrderItem>): Promise<void> {
    const item = event.entity;
    const previous = event.databaseEntity;
    if (!item || item.status !== 'Cancelled' || previous?.status === 'Cancelled') {
      return;
    }

    await event.manager
      .createQueryBuilder()
      .update(PharmacyDispensing)
      .set({ status: 'Cancelled', cancelReason: 'Order item cancelled' })
      .where('orderItemId = :orderItemId', { orderItemId: item.id })
      .andWhere('status = :status', { status: 'Pending' })
      .execute();
  }
}
