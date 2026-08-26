import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('stock_balances')
export class StockBalance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'uuid' }) stockBatchId!: string;
  @Column({ type: 'numeric', default: 0 }) availableQuantity!: string;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
