import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type InvoiceStatus = 'open' | 'paid';

/** A platform billing invoice for one subscription period (public schema). */
@Entity('subscription_invoices')
export class SubscriptionInvoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  subscriptionId!: string;

  @Column({ type: 'varchar' })
  tenantId!: string;

  @Column({ type: 'timestamptz' })
  periodStart!: Date;

  @Column({ type: 'timestamptz' })
  periodEnd!: Date;

  /** Amount in ₹ for the period (the subscription's pricePerCycle). */
  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: InvoiceStatus;

  @CreateDateColumn()
  issuedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;
}
