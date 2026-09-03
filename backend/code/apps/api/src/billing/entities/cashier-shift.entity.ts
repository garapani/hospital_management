import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AuditableEntity } from '../../database/auditable.entity.js';
import { numericTransformer } from './numeric.transformer.js';

export type CashierShiftStatus = 'Open' | 'Closed';

/** One row per denomination counted at close, e.g. `{ "500": 10, "200": 5, "100": 3 }`. */
export type DenominationCounts = Record<string, number>;

/** One declared total per non-cash payment mode at close, e.g. `{ "Card": 5000, "UPI": 8400 }`. */
export type ModeDeclaredTotals = Record<string, number>;

// No delete action available — a closed shift is a permanent financial record, never removed
// through a normal user action (extends AuditableEntity, not SoftDeletableEntity; see that file's
// scoping comment).
@Entity('cashier_shifts')
export class CashierShift extends AuditableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  openedBy!: string;

  @Column({ type: 'timestamptz' })
  openedAt!: Date;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  floatAmount!: number;

  @Column({ type: 'varchar', length: 20, default: 'Open' })
  status!: CashierShiftStatus;

  @Column({ type: 'varchar', nullable: true })
  closedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  cashDenominationCounts!: DenominationCounts | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  cashDeclaredTotal!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  modeDeclaredTotals!: ModeDeclaredTotals | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
