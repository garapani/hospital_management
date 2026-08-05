import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lab_results')
export class LabResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  requisitionId!: string;

  @Column({ type: 'uuid' })
  componentId!: string;

  @Column({ type: 'varchar' })
  value!: string; // numeric or qualitative ('Positive'/'Negative')

  @Column({ type: 'boolean', default: false })
  isAbnormal!: boolean;

  @Column({ type: 'uuid' })
  enteredBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  enteredAt!: Date;
}
