import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './numeric.transformer.js';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'varchar', length: 20 })
  paymentMode!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceDepositId!: string | null;

  // Set automatically by PaymentShiftTagSubscriber when the recording account has an open
  // CashierShift — null when no shift is open (shift tracking is optional/additive, not a
  // precondition for recording a payment; see cashier-shift.service.ts).
  @Column({ type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ type: 'uuid' })
  receivedBy!: string;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  receivedAt!: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;
}
