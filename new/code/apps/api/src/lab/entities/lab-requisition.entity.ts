import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('lab_requisitions')
export class LabRequisition extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderItemId!: string;

  @Column({ type: 'uuid' })
  testId!: string;

  @Column({ type: 'varchar', unique: true })
  requisitionNumber!: string;

  @Column({ type: 'varchar' })
  specimenType!: string;

  @Column({ type: 'varchar', default: 'Pending' })
  status!: string; // 'Pending' | 'SampleCollected' | 'ResultsEntered' | 'Verified' | 'Cancelled'

  @Column({ type: 'uuid', nullable: true })
  sampleCollectedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sampleCollectedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;
}
