import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('stock_batches')
export class StockBatch extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'varchar' }) batchNumber!: string;
  @Column({ type: 'date', nullable: true }) expiryDate!: string | null;
  @Column({ type: 'numeric' }) unitCost!: string;
  @Column({ type: 'numeric', nullable: true }) mrp!: string | null;
}
