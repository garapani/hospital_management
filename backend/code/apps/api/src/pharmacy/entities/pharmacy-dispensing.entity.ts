import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';
import { OrderItem } from '../../orders/entities/order-item.entity.js';

@Entity('pharmacy_dispensings')
export class PharmacyDispensing extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  // Null for a walk-in/OTC sale (PharmacyDispensingService.createWalkInSale) — there is no
  // doctor's order behind it. Always set for an order-routed dispensing.
  @Column({ type: 'uuid', nullable: true }) orderItemId!: string | null;
  // Declared relation for the list views that join the order item's description — the orderItemId
  // column remains the source of truth and the pharmacy→orders edge already exists via the
  // dispensing service's OrdersService dependency.
  @ManyToOne(() => OrderItem, { nullable: true })
  @JoinColumn({ name: 'orderItemId' })
  orderItem!: OrderItem | null;
  // Set only for a walk-in/OTC sale — an order-routed dispensing derives its patient via
  // orders.patientId instead, so this stays null there (same "populated on one path only" idiom
  // invoice_items.sourceOrderItemId already uses).
  @Column({ type: 'uuid', nullable: true }) patientId!: string | null;
  @Column({ type: 'uuid' }) inventoryItemId!: string;
  @Column({ type: 'varchar', unique: true }) dispensingNumber!: string;
  @Column({ type: 'numeric' }) quantity!: string;
  @Column({ type: 'varchar', default: 'Pending' }) status!: string;
  // 'Pending' | 'Dispensed' | 'Cancelled' | 'Reversed'
  @Column({ type: 'uuid', nullable: true }) dispensedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) dispensedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @Column({ type: 'uuid', nullable: true }) reversedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reversedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) reversalReason!: string | null;
}
