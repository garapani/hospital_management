import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A patient's vaccination record.
 */
@Entity('vaccination_records')
export class VaccinationRecord {
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
