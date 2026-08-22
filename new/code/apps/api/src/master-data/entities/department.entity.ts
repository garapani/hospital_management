import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('departments')
export class Department extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  departmentCode!: string;

  @Column()
  departmentName!: string;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: false })
  isAppointmentApplicable!: boolean;

  @Column({ type: 'uuid', nullable: true })
  parentDepartmentId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  roomNumber!: string | null;

  @Column({ type: 'varchar', nullable: true })
  noticeText!: string | null;

  @Column({ type: 'integer', nullable: true })
  maxDailyAppointments!: number | null;
}
