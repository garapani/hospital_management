import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Patient } from './patient.entity.js';

@Entity('patient_kins')
export class PatientKin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar', length: 150 })
  kinName!: string;

  @Column({ type: 'varchar', length: 50 })
  relationship!: string;

  @Column({ type: 'varchar', length: 20 })
  phoneNumber!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @ManyToOne('Patient', (patient: Patient) => patient.kins, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient!: Patient;
}
