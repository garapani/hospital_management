import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('purchase_orders')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) vendorId!: string;
  @Column({ type: 'varchar', unique: true }) purchaseOrderNumber!: string;
  @Column({ type: 'uuid' }) orderedBy!: string;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }) orderedAt!: Date;
  @Column({ type: 'varchar', default: 'Ordered' }) status!: string;
  // 'Ordered' | 'PartiallyReceived' | 'Received' | 'Cancelled'
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
