import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrderBillingAdapter, OrderBillingItem } from './order-billing.adapter';
import { OrderItem } from '../orders/entities/order-item.entity';
import { RadiologyRequisition } from '../../radiology/entities/radiology-requisition.entity';

@Injectable()
export class RadiologyBillingAdapter implements OrderBillingAdapter {
  async getItemPrice(manager: EntityManager, orderItem: OrderItem): Promise<OrderBillingItem | null> {
    if (orderItem.itemType !== 'Radiology') {
      return null;
    }

    const radiologyRequisition = await manager.getRepository(RadiologyRequisition).findOne({
      where: { orderItemId: orderItem.id },
    });

    if (!radiologyRequisition) {
      return null;
    }

    // Lookup imaging item price from radiology_catalog_items
    const itemPrice = await manager.query(
      `SELECT price FROM radiology_catalog_items WHERE id = $1`,
      [radiologyRequisition.imagingItemId]
    );

    const unitPrice = itemPrice?.[0]?.price ?? 0;
    
    if (unitPrice <= 0) {
      return null;
    }

    return {
      itemId: radiologyRequisition.imagingItemId,
      description: orderItem.itemDescription,
      unitPrice,
      quantity: 1,
      taxPercent: 0
    };
  }
}
