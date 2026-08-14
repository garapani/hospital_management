import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from './numeric.transformer.js';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceAppointmentId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceAdmissionId!: string | null;

  @Column({ type: 'integer' })
  invoiceNumber!: number;

  @Column({ type: 'varchar', length: 10 })
  financialYear!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  subtotal!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  discountAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  taxableAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  taxAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  totalAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number;

  @Column({ type: 'varchar', length: 20, default: 'Unpaid' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;
}
