import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('lab_test_components')
export class LabTestComponent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  testId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  unit!: string | null;

  @Column({ type: 'numeric', nullable: true })
  referenceRangeLow!: string | null;

  @Column({ type: 'numeric', nullable: true })
  referenceRangeHigh!: string | null;

  @Column({ type: 'varchar', nullable: true })
  referenceRangeText!: string | null; // e.g. 'Negative'

  @Column({ type: 'int', default: 0 })
  displaySequence!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
