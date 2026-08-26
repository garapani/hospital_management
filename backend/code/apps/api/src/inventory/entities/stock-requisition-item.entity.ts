import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('stock_requisition_items')
export class StockRequisitionItem extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) requisitionId!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'numeric' }) requestedQuantity!: string;
  @Column({ type: 'numeric', default: 0 }) fulfilledQuantity!: string;
}
