import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

export type NursingTaskStatus = 'Pending' | 'InProgress' | 'Completed' | 'Cancelled';

/**
 * A nursing task assigned to an admission (vitals check, dressing, care activity, ...).
 */
@Entity('nursing_tasks')
export class NursingTask extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  admissionId!: string;

  @Column({ type: 'varchar' })
  taskType!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ type: 'varchar', default: 'Pending' })
  status!: NursingTaskStatus;

  @Column({ type: 'uuid', nullable: true })
  assignedTo!: string | null;

  // varchar, not uuid: matches the audit-columns convention (auditable.entity.ts) — this
  // codebase's test suite signs tokens with human-readable sub values a uuid column would reject.
  @Column({ type: 'varchar', nullable: true })
  completedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}

export type MedicationAdministrationStatus = 'Scheduled' | 'Administered' | 'Skipped';

/**
 * Medication administration record (MAR) line for an admission.
 */
@Entity('medication_administrations')
export class MedicationAdministration extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  admissionId!: string;

  /**
   * What authorized this dose, if it originated from a formal prescription
   * (clinical/encounters' Prescription) — nullable because not every MAR line traces back to one
   * (e.g. a nurse-initiated PRN intervention). No DB-level FK: same raw-lookup-only convention as
   * admissionId on this table (see NursingService.assertAdmissionExists) — validated at the
   * application layer, not the schema layer.
   */
  @Column({ type: 'uuid', nullable: true })
  prescriptionId!: string | null;

  @Column({ type: 'varchar' })
  drugName!: string;

  @Column({ type: 'varchar' })
  dose!: string;

  @Column({ type: 'varchar', nullable: true })
  route!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'varchar', default: 'Scheduled' })
  status!: MedicationAdministrationStatus;

  // varchar, not uuid: matches the audit-columns convention (auditable.entity.ts) — this
  // codebase's test suite signs tokens with human-readable sub values a uuid column would reject.
  @Column({ type: 'varchar', nullable: true })
  administeredBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  administeredAt!: Date | null;

  /** Set when status becomes 'Skipped' — distinct from administeredBy, which stays null for a skip.
   *  varchar, not uuid — see completedBy above for why. */
  @Column({ type: 'varchar', nullable: true })
  skippedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
