import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { RadiologyRequisition } from './entities/radiology-requisition.entity.js';
import { NON_TERMINAL_STATUSES } from './radiology-workflow.service.js';

/**
 * Cascades an order-item cancellation onto any still-live Radiology requisition riding on it. See
 * `LabOrderCancellationSubscriber` for the full rationale — same pattern, same
 * code-review-findings-2026-08-25 orders P2, mirrored per workflow module because each owns its
 * own requisition table and non-terminal-status list.
 */
@Injectable()
export class RadiologyOrderCancellationSubscriber
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
      .update(RadiologyRequisition)
      .set({ status: 'Cancelled', cancelReason: 'Order item cancelled' })
      .where('orderItemId = :orderItemId', { orderItemId: item.id })
      .andWhere('status IN (:...statuses)', { statuses: NON_TERMINAL_STATUSES })
      .execute();
  }
}
