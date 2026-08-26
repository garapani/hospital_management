import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { SoftDeletableEntity } from '../../../database/auditable.entity.js';

@Entity('triage_entries')
export class TriageEntry extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Link to a registered patient if known
  @Column({ type: 'uuid', nullable: true })
  patientId!: string | null;

  // Anonymous Demographics (used if patientId is null)
  @Column({ type: 'varchar', nullable: true })
  firstName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  gender!: string | null;

  @Column({ type: 'varchar', nullable: true })
  estimatedAge!: string | null;

  // Arrival Details
  @Column({ type: 'varchar', nullable: true })
  arrivalMode!: string | null; // e.g., 'Ambulance', 'Walk-in', 'Police'

  @Column({ type: 'varchar', nullable: true })
  broughtBy!: string | null;

  @Column({ type: 'boolean', default: false })
  isPoliceCase!: boolean;

  // Clinical/Triage Details
  @Column({ type: 'text', nullable: true })
  chiefComplaint!: string | null;

  @Column({ type: 'int', nullable: true })
  acuityLevel!: number | null; // 1=Resuscitation, 2=Emergent, 3=Urgent, 4=Less Urgent, 5=Non-Urgent

  @Column({ type: 'varchar', nullable: true })
  colorCode!: string | null; // Red, Orange, Yellow, Green, Blue

  @Column({ type: 'uuid', nullable: true })
  triagedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  triagedAt!: Date | null;

  // Lifecycle Status
  @Column({ type: 'varchar', default: 'Arrived' })
  status!: string; // 'Arrived', 'Triaged', 'In Treatment', 'Discharged', 'Admitted', 'Deceased'

  @Column({ type: 'text', nullable: true })
  dischargeRemarks!: string | null;
}
