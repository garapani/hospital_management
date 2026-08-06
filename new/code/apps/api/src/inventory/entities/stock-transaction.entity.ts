import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('stock_transactions')
export class StockTransaction {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'uuid' }) stockBatchId!: string;
  @Column({ type: 'varchar' }) transactionType!: string; // 'GoodsReceipt' | 'Dispatch'
  @Column({ type: 'uuid', nullable: true }) referenceId!: string | null;
  @Column({ type: 'numeric' }) quantity!: string;
  @Column({ type: 'uuid' }) recordedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
