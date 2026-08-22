import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { SoftDeletableEntity } from '../../../database/auditable.entity.js';

@Entity('diagnoses')
export class Diagnosis extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  appointmentId?: string;

  @Column({ type: 'uuid' })
  doctorId!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  icd10Code?: string;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  @Column({ type: 'boolean', default: false })
  isPrimary!: boolean;
}
