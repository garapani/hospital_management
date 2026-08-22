import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create a payroll -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

export type PayslipStatus = 'Draft' | 'Paid';

/**
 * One month's payslip for one employee. The amounts are computed from
 * Employee.monthlyBasicSalary at run time and stored (a payslip is a snapshot, not a live
 * formula).
 */
@Entity('payslips')
@Unique(['employeeId', 'periodMonth', 'periodYear'])
export class Payslip extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  employeeId!: string;

  @Column({ type: 'int' })
  periodMonth!: number;

  @Column({ type: 'int' })
  periodYear!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  basicAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  allowanceAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  grossAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  deductionAmount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  netAmount!: number;

  @Column({ type: 'varchar', default: 'Draft' })
  status!: PayslipStatus;

  /** Actor who generated the payslip (see §25). */
  @Column({ type: 'uuid' })
  processedBy!: string;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
