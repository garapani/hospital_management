import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { LabRequisition } from './entities/lab-requisition.entity.js';
import { NON_TERMINAL_STATUSES } from './lab-workflow.service.js';

/**
 * Cascades an order-item cancellation onto any still-live Lab requisition riding on it
 * (code-review-findings-2026-08-25 orders P2: cancelling an order item left its downstream
 * requisition live with no cascade). Wired the same way as `ChargeCaptureSubscriber` — registered
 * on the main DataSource from `OnModuleInit` — but, unlike that subscriber, can bind via
 * `listenTo(() => OrderItem)` instead of a tableName string filter: `lab` already has a sanctioned
 * dependency on `orders` (it imports the `OrderItem` entity directly elsewhere in this module), so
 * this doesn't create a new module-boundary edge.
 */
@Injectable()
export class LabOrderCancellationSubscriber implements EntitySubscriberInterface<OrderItem>, OnModuleInit {
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
      .update(LabRequisition)
      .set({ status: 'Cancelled', cancelReason: 'Order item cancelled' })
      .where('orderItemId = :orderItemId', { orderItemId: item.id })
      .andWhere('status IN (:...statuses)', { statuses: NON_TERMINAL_STATUSES })
      .execute();
  }
}
