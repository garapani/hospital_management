import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

export type OtSurgeryStatus = 'Scheduled' | 'InProgress' | 'Completed' | 'Cancelled';

/**
 * Operation Theatre surgery record: scheduling + execution status.
 */
@Entity('ot_surgeries')
export class OtSurgery extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  surgeryNumber!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  admissionId!: string | null;

  @Column({ type: 'varchar' })
  procedureName!: string;

  @Column({ type: 'varchar', nullable: true })
  otRoom!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  surgeonId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  anesthesiologistId!: string | null;

  @Column({ type: 'varchar', default: 'Scheduled' })
  status!: OtSurgeryStatus;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid' })
  scheduledBy!: string;
}
