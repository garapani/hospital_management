import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create an ssu -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

export type SsuCaseStatus = 'Open' | 'Approved' | 'Rejected' | 'Closed';

/**
 * Social Service Unit case: charity/subsidized care for a patient. subsidyPercent is the portion
 * of bills the hospital writes off (0-100).
 */
@Entity('ssu_cases')
export class SsuCase extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  caseNumber!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar' })
  caseType!: string;

  @Column({ type: 'text', nullable: true })
  eligibilityNotes!: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numericTransformer })
  subsidyPercent!: number;

  @Column({ type: 'varchar', default: 'Open' })
  status!: SsuCaseStatus;

  /** Actor who opened the case (see §25). */
  @Column({ type: 'uuid' })
  appliedBy!: string;

  /** Actor who approved/rejected it (see §25). */
  @Column({ type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionNotes!: string | null;
}
