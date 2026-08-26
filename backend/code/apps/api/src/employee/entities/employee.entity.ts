import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

export type EmploymentType = 'FullTime' | 'PartTime' | 'Contract';

/**
 * HR employee master.
 */
@Entity('employees')
export class Employee extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  employeeCode!: string;

  @Column({ type: 'varchar' })
  firstName!: string;

  @Column({ type: 'varchar' })
  lastName!: string;

  @Column({ type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  designation!: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'date' })
  joinDate!: string;

  @Column({ type: 'varchar', default: 'FullTime' })
  employmentType!: EmploymentType;

  /** Monthly basic salary in INR (payroll computation uses this as the base). */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: { to: (v: number | null) => v, from: (v: string | null) => (v === null ? null : Number(v)) } })
  monthlyBasicSalary!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
