import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { SoftDeletableEntity } from '../../../database/auditable.entity.js';

@Entity('prescriptions')
export class Prescription extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  appointmentId?: string;

  @Column({ type: 'uuid' })
  doctorId!: string;

  @Column({ type: 'varchar', length: 255 })
  medicationName!: string;

  @Column({ type: 'varchar', length: 100 })
  dosage!: string;

  @Column({ type: 'varchar', length: 100 })
  frequency!: string;

  @Column({ type: 'varchar', length: 100 })
  route!: string;

  @Column({ type: 'int' })
  durationDays!: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'varchar', length: 50, default: 'Active' })
  status!: string;
}
