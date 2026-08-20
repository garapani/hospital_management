import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create a fraction -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

/**
 * A doctor's revenue-share rule: fractionPercent of the billable amount on invoices that carry
 * the rule's department (or any department when departmentId is null).
 */
@Entity('fraction_rules')
export class FractionRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  doctorId!: string;

  @Column({ type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: numericTransformer })
  fractionPercent!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * A computed share for one doctor against one invoice (snapshot of the rule's percent and the
 * base amount at recording time).
 */
@Entity('fraction_entries')
export class FractionEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'uuid' })
  doctorId!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: numericTransformer })
  fractionPercent!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  baseAmount!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  shareAmount!: number;

  /** Actor who recorded the share (see §25). */
  @Column({ type: 'uuid' })
  recordedBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
