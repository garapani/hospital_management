import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { OrderItem } from '../../orders/entities/order-item.entity.js';

@Entity('pharmacy_dispensings')
export class PharmacyDispensing {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) orderItemId!: string;
  // Declared relation for the list views that join the order item's description — the orderItemId
  // column remains the source of truth and the pharmacy→orders edge already exists via the
  // dispensing service's OrdersService dependency.
  @ManyToOne(() => OrderItem, { nullable: false })
  @JoinColumn({ name: 'orderItemId' })
  orderItem!: OrderItem;
  @Column({ type: 'uuid' }) inventoryItemId!: string;
  @Column({ type: 'varchar', unique: true }) dispensingNumber!: string;
  @Column({ type: 'numeric' }) quantity!: string;
  @Column({ type: 'varchar', default: 'Pending' }) status!: string;
  // 'Pending' | 'Dispensed' | 'Cancelled'
  @Column({ type: 'uuid', nullable: true }) dispensedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) dispensedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
