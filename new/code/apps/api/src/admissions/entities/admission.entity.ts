import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('admissions')
export class Admission extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar' })
  admissionSource!: string; // 'OPD' | 'ER' | 'Direct'

  @Column({ type: 'uuid', nullable: true })
  sourceAppointmentId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceTriageEntryId!: string | null;

  @Column({ type: 'uuid' })
  admittingDoctorId!: string;

  @Column({ type: 'uuid' })
  wardId!: string;

  @Column({ type: 'uuid' })
  bedId!: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  admissionDate!: Date;

  @Column({ type: 'varchar', default: 'Admitted' })
  status!: string; // 'Admitted' | 'Discharged'

  @Column({ type: 'timestamptz', nullable: true })
  dischargeDate!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  dischargeType!: string | null;

  @Column({ type: 'varchar', nullable: true })
  dischargeCondition!: string | null;

  /**
   * A quick free-text note captured at the moment of discharge (`AdmissionsService.discharge()`)
   * — not the formal, structured, reviewable clinical document. That's the separate
   * `DischargeSummary` entity (one per admission, created afterward via `createDischargeSummary`),
   * which this field is never read from or written back to. Two different things that happen to
   * share a name; don't conflate them.
   */
  @Column({ type: 'text', nullable: true })
  dischargeSummary!: string | null;

  @Column({ type: 'uuid', nullable: true })
  dischargedBy!: string | null;
}
