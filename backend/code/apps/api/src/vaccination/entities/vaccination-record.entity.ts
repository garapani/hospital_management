import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

/**
 * A patient's vaccination record.
 */
@Entity('vaccination_records')
export class VaccinationRecord extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar' })
  vaccine!: string;

  @Column({ type: 'int', default: 1 })
  doseNumber!: number;

  @Column({ type: 'date' })
  administeredDate!: string;

  @Column({ type: 'varchar', nullable: true })
  batchNumber!: string | null;

  /** Actor who administered it (see §25 — a clinical sign-off). */
  @Column({ type: 'uuid' })
  administeredBy!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
