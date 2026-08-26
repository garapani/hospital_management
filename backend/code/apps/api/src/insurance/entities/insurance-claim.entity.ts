import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create an insurance -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

export type InsuranceClaimStatus = 'Draft' | 'Submitted' | 'Approved' | 'Paid' | 'Rejected';
export const INSURANCE_CLAIM_STATUSES: InsuranceClaimStatus[] = [
  'Draft',
  'Submitted',
  'Approved',
  'Paid',
  'Rejected',
];

/**
 * A reimbursement claim against one invoice. The lifecycle:
 *   Draft -> Submitted -> Approved -> Paid
 *                    `-----> Rejected
 * Amounts in INR. The claim tracks the insurance reimbursement only — patient-side settlement
 * stays in Billing (the invoice's own payment records).
 */
@Entity('insurance_claims')
export class InsuranceClaim extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  claimNumber!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid' })
  policyId!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amountClaimed!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  amountApproved!: number | null;

  @Column({ type: 'varchar', default: 'Draft' })
  status!: InsuranceClaimStatus;

  @Column({ type: 'text', nullable: true })
  remarks!: string | null;

  @Column({ type: 'uuid' })
  submittedBy!: string;

  @Column({ type: 'uuid', nullable: true })
  processedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}
