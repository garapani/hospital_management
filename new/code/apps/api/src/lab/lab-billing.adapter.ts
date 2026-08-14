import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderBillingAdapter, OrderBillingItem } from '../../billing/adapters/order-billing.adapter.js';

/**
 * Lab module's implementation of the OrderBillingAdapter.
 * Provides pricing information for lab test order items.
 */
@Injectable()
export class LabBillingAdapter implements OrderBillingAdapter {
  constructor(private readonly dataSource: DataSource) {}

  async getBillingInfo(orderItemId: string): Promise<OrderBillingItem | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      
      // Get the lab requisition for this order item
      const labRequisition = await queryRunner.manager.query(
        `SELECT "testId", "orderItemId" FROM lab_requisitions WHERE "orderItemId" = $1`,
        [orderItemId]
      );
      
      if (!labRequisition || labRequisition.length === 0) {
        return null;
      }
      
      const testId = labRequisition[0].testId;
      
      // Get the test price from catalog
      const testResult = await queryRunner.manager.query(
        `SELECT id, name, price FROM lab_catalog_tests WHERE id = $1`,
        [testId]
      );
      
      if (!testResult || testResult.length === 0 || !testResult[0].price) {
        return null;
      }
      
      return {
        itemId: testResult[0].id,
        description: testResult[0].name,
        unitPrice: testResult[0].price,
        quantity: 1,
        taxPercent: 0,
      };
    } finally {
      await queryRunner.release();
    }
  }
}
