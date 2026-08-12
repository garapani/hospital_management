import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('departments')
export class Department {
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

  @CreateDateColumn()
  createdAt!: Date;
}
