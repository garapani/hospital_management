import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './numeric.transformer.js';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('invoices')
export class Invoice extends SoftDeletableEntity {
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
}
