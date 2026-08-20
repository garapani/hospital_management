import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ReferralSourceType = 'Doctor' | 'Walk-in' | 'Advertising' | 'Social Media' | 'Other';

/**
 * A referral source the hospital tracks (where patients come from).
 */
@Entity('referral_sources')
export class ReferralSource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', default: 'Other' })
  sourceType!: ReferralSourceType;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * A patient's referral record (patient registered via this source).
 */
@Entity('patient_referrals')
export class PatientReferral {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid' })
  sourceId!: string;

  @Column({ type: 'uuid', nullable: true })
  referredByDoctorId!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  referredAt!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Actor who recorded the referral (see §25). */
  @Column({ type: 'uuid' })
  recordedBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
