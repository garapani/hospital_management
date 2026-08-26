import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './numeric.transformer.js';

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceOrderItemId!: string | null;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  hsnSacCode!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1, transformer: numericTransformer })
  quantity!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  unitPrice!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  discountAmount!: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numericTransformer })
  taxPercent!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  cgstAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  sgstAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  totalAmount!: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;
}
