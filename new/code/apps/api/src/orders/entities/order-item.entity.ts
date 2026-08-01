import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({ type: 'varchar' })
  itemType!: string; // 'Lab' | 'Radiology' | 'Pharmacy' | 'Other'

  @Column({ type: 'text' })
  itemDescription!: string;

  @Column({ type: 'varchar', default: 'Routine' })
  priority!: string; // 'Routine' | 'Urgent' | 'STAT'

  @Column({ type: 'varchar', default: 'Pending' })
  status!: string; // 'Pending' | 'Completed' | 'Cancelled'

  @Column({ type: 'uuid', nullable: true })
  completedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
