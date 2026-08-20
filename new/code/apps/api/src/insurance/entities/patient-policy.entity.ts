import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create an insurance -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

/**
 * A patient's insurance coverage under one payer. Eligibility = isActive AND the coverage window
 * contains the date in question (see InsuranceClaimsService.checkCoverage).
 */
@Entity('patient_policies')
export class PatientPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid' })
  payerId!: string;

  @Column({ type: 'varchar' })
  policyNumber!: string;

  @Column({ type: 'varchar', nullable: true })
  insuredName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  relationshipToInsured!: string | null;

  @Column({ type: 'date' })
  coverageStartDate!: string;

  @Column({ type: 'date' })
  coverageEndDate!: string;

  /** Max coverage amount in INR. */
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  sumInsured!: number;

  /** Patient's share percentage (0-100); the rest is billed to the payer. */
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numericTransformer })
  copayPercent!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
