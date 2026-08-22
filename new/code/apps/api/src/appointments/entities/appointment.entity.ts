import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('appointments')
export class Appointment extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  patientId!: string | null;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 20 })
  contactNumber!: string;

  @Column({ type: 'date' })
  appointmentDate!: string;

  @Column({ type: 'time' })
  appointmentTime!: string;

  @Column({ type: 'uuid', nullable: true })
  doctorId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ type: 'varchar', length: 50 })
  appointmentType!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelledRemarks!: string | null;
}
