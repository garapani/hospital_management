import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; this platform table predates the numericTransformer convention, so it mirrors it.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

export type InvoiceStatus = 'open' | 'paid';

/** A platform billing invoice for one subscription period (public schema). */
@Entity('subscription_invoices')
export class SubscriptionInvoice extends SoftDeletableEntity {
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

  /** Vendor-side invoice number, unique per (subscriptionId, periodStart) — migration 0084. */
  @Column({ type: 'varchar', nullable: true })
  invoiceNumber!: string | null;

  /** Platform GST rate applied at issue time (PLATFORM_GST_PERCENT). */
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numericTransformer })
  taxPercent!: number;

  /** Platform GST amount on the period's amount; payable total = amount + taxAmount. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  taxAmount!: number;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: InvoiceStatus;

  @CreateDateColumn()
  issuedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;
}
