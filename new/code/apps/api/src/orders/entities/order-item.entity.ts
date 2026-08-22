import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('order_items')
export class OrderItem extends SoftDeletableEntity {
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
}
