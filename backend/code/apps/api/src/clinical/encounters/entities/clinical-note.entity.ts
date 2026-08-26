import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { SoftDeletableEntity } from '../../../database/auditable.entity.js';

@Entity('clinical_notes')
export class ClinicalNote extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  appointmentId?: string;

  @Column({ type: 'uuid' })
  doctorId!: string;

  @Column({ type: 'text', nullable: true })
  chiefComplaint?: string;

  @Column({ type: 'text', nullable: true })
  historyOfPresentingIllness?: string;

  @Column({ type: 'text', nullable: true })
  physicalExamination?: string;

  @Column({ type: 'text', nullable: true })
  plan?: string;

  @Column({ type: 'varchar', length: 50, default: 'Draft' })
  status!: string;
}
