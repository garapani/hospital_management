import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('purchase_order_items')
export class PurchaseOrderItem extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) purchaseOrderId!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'numeric' }) orderedQuantity!: string;
  @Column({ type: 'numeric', default: 0 }) receivedQuantity!: string;
  @Column({ type: 'numeric' }) unitCost!: string;
}
