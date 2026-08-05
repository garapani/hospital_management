import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('stock_batches')
export class StockBatch {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'varchar' }) batchNumber!: string;
  @Column({ type: 'date', nullable: true }) expiryDate!: string | null;
  @Column({ type: 'numeric' }) unitCost!: string;
  @Column({ type: 'numeric', nullable: true }) mrp!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
