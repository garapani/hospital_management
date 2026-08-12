import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('department_catalog')
export class DepartmentCatalog {
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

  @CreateDateColumn()
  createdAt!: Date;
}
