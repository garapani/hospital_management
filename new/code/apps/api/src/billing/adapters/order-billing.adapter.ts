/**
 * Interface for billing adapters that decouple the billing module
 * from clinical modules (Lab, Radiology, Pharmacy).
 * 
 * Each clinical module implements this interface to provide pricing
 * and item details without the billing module directly depending on
 * their entity types.
 */

export interface OrderBillingItem {
  itemId: string;
  description: string;
  unitPrice: number;
  quantity?: number;
  taxPercent?: number;
}

export interface OrderBillingAdapter {
  /**
   * Get billing information for an order item.
   * @param orderItemId The ID of the order item to get billing info for
   * @returns Billing details or null if not found/not billable
   */
  getBillingInfo(orderItemId: string): Promise<OrderBillingItem | null>;
}
