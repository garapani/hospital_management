import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('department_catalog')
export class DepartmentCatalog extends SoftDeletableEntity {
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
}
