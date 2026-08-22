import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Patient } from './patient.entity.js';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('patient_addresses')
export class PatientAddress extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar', length: 20, default: 'home' })
  addressType!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  streetAddress!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', length: 100, default: 'India' })
  country!: string;

  @ManyToOne('Patient', (patient: Patient) => patient.addresses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient!: Patient;
}
