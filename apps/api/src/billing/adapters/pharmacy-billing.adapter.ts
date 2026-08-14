import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrderBillingAdapter, OrderBillingItem } from './order-billing.adapter';
import { OrderItem } from '../orders/entities/order-item.entity';
import { PharmacyDispensing } from '../../pharmacy/entities/pharmacy-dispensing.entity';

@Injectable()
export class PharmacyBillingAdapter implements OrderBillingAdapter {
  async getItemPrice(manager: EntityManager, orderItem: OrderItem): Promise<OrderBillingItem | null> {
    if (orderItem.itemType !== 'Pharmacy') {
      return null;
    }

    const pharmacyDispensing = await manager.getRepository(PharmacyDispensing).findOne({
      where: { orderItemId: orderItem.id },
    });

    if (!pharmacyDispensing) {
      return null;
    }

    // Lookup drug price from inventory_catalog_items
    const drugPrice = await manager.query(
      `SELECT salePrice FROM inventory_catalog_items WHERE id = $1`,
      [pharmacyDispensing.inventoryItemId]
    );

    const unitPrice = drugPrice?.[0]?.salePrice ?? 0;
    
    if (unitPrice <= 0) {
      return null;
    }

    return {
      itemId: pharmacyDispensing.inventoryItemId,
      description: `${orderItem.itemDescription} (Qty: ${pharmacyDispensing.quantity})`,
      unitPrice,
      quantity: pharmacyDispensing.quantity,
      taxPercent: 0
    };
  }
}
