import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrderBillingAdapter, OrderBillingItem } from './order-billing.adapter';
import { OrderItem } from '../orders/entities/order-item.entity';
import { LabRequisition } from '../../lab/entities/lab-requisition.entity';

@Injectable()
export class LabBillingAdapter implements OrderBillingAdapter {
  async getItemPrice(manager: EntityManager, orderItem: OrderItem): Promise<OrderBillingItem | null> {
    if (orderItem.itemType !== 'Lab') {
      return null;
    }

    const labRequisition = await manager.getRepository(LabRequisition).findOne({
      where: { orderItemId: orderItem.id },
    });

    if (!labRequisition) {
      return null;
    }

    // Lookup test price from lab_catalog_tests
    const testPrice = await manager.query(
      `SELECT price FROM lab_catalog_tests WHERE id = $1`,
      [labRequisition.testId]
    );

    const unitPrice = testPrice?.[0]?.price ?? 0;
    
    if (unitPrice <= 0) {
      return null;
    }

    return {
      itemId: labRequisition.testId,
      description: orderItem.itemDescription,
      unitPrice,
      quantity: 1,
      taxPercent: 0
    };
  }
}
