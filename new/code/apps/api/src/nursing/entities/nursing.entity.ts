import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type NursingTaskStatus = 'Pending' | 'InProgress' | 'Completed' | 'Cancelled';

/**
 * A nursing task assigned to an admission (vitals check, dressing, care activity, ...).
 */
@Entity('nursing_tasks')
export class NursingTask {
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

  @Column({ type: 'uuid', nullable: true })
  completedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

export type MedicationAdministrationStatus = 'Scheduled' | 'Administered' | 'Skipped';

/**
 * Medication administration record (MAR) line for an admission.
 */
@Entity('medication_administrations')
export class MedicationAdministration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  admissionId!: string;

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

  @Column({ type: 'uuid', nullable: true })
  administeredBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  administeredAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
