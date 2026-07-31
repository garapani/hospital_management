import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PatientAddress } from './patient-address.entity.js';
import { PatientKin } from './patient-kin.entity.js';

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  patientNo!: string;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  middleName!: string | null;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 20 })
  gender!: string;

  @Column({ type: 'date', nullable: true })
  dateOfBirth!: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  age!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  bloodGroup!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  governmentIdType!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  governmentIdNumber!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => PatientAddress, (address) => address.patient, { cascade: true })
  addresses!: PatientAddress[];

  @OneToMany(() => PatientKin, (kin) => kin.patient, { cascade: true })
  kins!: PatientKin[];
}
