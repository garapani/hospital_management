import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderBillingAdapter, OrderBillingItem } from '../../billing/adapters/order-billing.adapter.js';

/**
 * Radiology module's implementation of the OrderBillingAdapter.
 * Provides pricing information for radiology imaging order items.
 */
@Injectable()
export class RadiologyBillingAdapter implements OrderBillingAdapter {
  constructor(private readonly dataSource: DataSource) {}

  async getBillingInfo(orderItemId: string): Promise<OrderBillingItem | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      
      // Get the radiology requisition for this order item
      const radiologyRequisition = await queryRunner.manager.query(
        `SELECT "imagingItemId", "orderItemId" FROM radiology_requisitions WHERE "orderItemId" = $1`,
        [orderItemId]
      );
      
      if (!radiologyRequisition || radiologyRequisition.length === 0) {
        return null;
      }
      
      const imagingItemId = radiologyRequisition[0].imagingItemId;
      
      // Get the imaging item price from catalog
      const imagingResult = await queryRunner.manager.query(
        `SELECT id, name, price FROM radiology_catalog_items WHERE id = $1`,
        [imagingItemId]
      );
      
      if (!imagingResult || imagingResult.length === 0 || !imagingResult[0].price) {
        return null;
      }
      
      return {
        itemId: imagingResult[0].id,
        description: imagingResult[0].name,
        unitPrice: imagingResult[0].price,
        quantity: 1,
        taxPercent: 0,
      };
    } finally {
      await queryRunner.release();
    }
  }
}
