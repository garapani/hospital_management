import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('discharge_summaries')
export class DischargeSummary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  admissionId!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'text', nullable: true })
  primaryDiagnosis!: string | null;

  @Column({ type: 'text', array: true, default: [] })
  secondaryDiagnoses!: string[];

  @Column({ type: 'text', array: true, default: [] })
  proceduresPerformed!: string[];

  @Column({ type: 'text', nullable: true })
  hospitalCourse!: string | null;

  @Column({ type: 'text', nullable: true })
  dischargeMedications!: string | null;

  @Column({ type: 'text', nullable: true })
  followUpInstructions!: string | null;

  @Column({ type: 'text', nullable: true })
  warningSigns!: string | null;

  @Column({ type: 'text', nullable: true })
  activityRestrictions!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  followUpAppointmentDate!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  followUpDoctorId!: string | null;

  @Column({ type: 'text', nullable: true })
  dietRecommendations!: string | null;

  @Column({ type: 'text', nullable: true })
  additionalNotes!: string | null;

  @Column({ type: 'uuid' })
  preparedBy!: string;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
