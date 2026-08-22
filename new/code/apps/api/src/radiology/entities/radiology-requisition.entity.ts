import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';
import { OrderItem } from '../../orders/entities/order-item.entity.js';

@Entity('radiology_requisitions')
export class RadiologyRequisition extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderItemId!: string;

  // Declared relation for the list views that join the order item's description — the
  // orderItemId column remains the source of truth and the radiology→orders edge already exists
  // via the workflow service's OrdersService dependency.
  @ManyToOne(() => OrderItem, { nullable: false })
  @JoinColumn({ name: 'orderItemId' })
  orderItem!: OrderItem;

  @Column({ type: 'uuid' })
  imagingItemId!: string;

  @Column({ type: 'varchar', unique: true })
  requisitionNumber!: string;

  @Column({ type: 'varchar', default: 'Pending' })
  status!: string; // 'Pending' | 'Scanned' | 'ReportEntered' | 'Verified' | 'Cancelled'

  @Column({ type: 'uuid', nullable: true })
  scannedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  scannedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reportText!: string | null;

  @Column({ type: 'text', nullable: true })
  indication!: string | null;

  @Column({ type: 'uuid', nullable: true })
  performerId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reportEnteredBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reportEnteredAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;
}
