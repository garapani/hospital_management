import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderBillingAdapter, OrderBillingItem } from '../../billing/adapters/order-billing.adapter.js';

/**
 * Pharmacy module's implementation of the OrderBillingAdapter.
 * Provides pricing information for pharmacy/dispensing order items.
 */
@Injectable()
export class PharmacyBillingAdapter implements OrderBillingAdapter {
  constructor(private readonly dataSource: DataSource) {}

  async getBillingInfo(orderItemId: string): Promise<OrderBillingItem | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      
      // Get the pharmacy dispensing record for this order item
      const pharmacyDispensing = await queryRunner.manager.query(
        `SELECT "inventoryItemId", quantity, "orderItemId" FROM pharmacy_dispensing WHERE "orderItemId" = $1`,
        [orderItemId]
      );
      
      if (!pharmacyDispensing || pharmacyDispensing.length === 0) {
        return null;
      }
      
      const inventoryItemId = pharmacyDispensing[0].inventoryItemId;
      const quantity = pharmacyDispensing[0].quantity;
      
      // Get the drug price from inventory catalog
      const drugResult = await queryRunner.manager.query(
        `SELECT id, name, "salePrice" FROM inventory_catalog_items WHERE id = $1`,
        [inventoryItemId]
      );
      
      if (!drugResult || drugResult.length === 0 || !drugResult[0].salePrice) {
        return null;
      }
      
      return {
        itemId: drugResult[0].id,
        description: `${drugResult[0].name} (Qty: ${quantity})`,
        unitPrice: drugResult[0].salePrice,
        quantity: quantity,
        taxPercent: 0,
      };
    } finally {
      await queryRunner.release();
    }
  }
}
