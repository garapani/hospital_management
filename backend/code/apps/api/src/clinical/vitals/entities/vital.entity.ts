import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { SoftDeletableEntity } from '../../../database/auditable.entity.js';

@Entity('vitals')
export class Vital extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  appointmentId?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  height?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  weight?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  bmi?: number | null;

  @Column({ type: 'decimal', precision: 4, scale: 1, nullable: true })
  temperature?: number;

  @Column({ type: 'int', nullable: true })
  pulse?: number;

  @Column({ type: 'int', nullable: true })
  bpSystolic?: number;

  @Column({ type: 'int', nullable: true })
  bpDiastolic?: number;

  @Column({ type: 'int', nullable: true })
  respiratoryRate?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  spO2?: number;

  @Column({ type: 'int', nullable: true })
  painScale?: number;

  @Column({ type: 'text', nullable: true })
  triageNotes?: string;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  recordedAt!: Date;
}
