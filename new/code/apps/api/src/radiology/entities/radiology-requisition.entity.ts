import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('radiology_requisitions')
export class RadiologyRequisition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderItemId!: string;

  @Column({ type: 'uuid' })
  imagingItemId!: string;

  @Column({ type: 'varchar', unique: true })
  requisitionNumber!: string;

  @Column({ type: 'varchar', default: 'Pending' })
  status!: string; // 'Pending' | 'Scanned' | 'ReportEntered' | 'Verified' | 'Cancelled'

  @Column({ type: 'uuid', nullable: true })
  scannedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  scannedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reportText!: string | null;

  @Column({ type: 'text', nullable: true })
  indication!: string | null;

  @Column({ type: 'uuid', nullable: true })
  performerId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reportEnteredBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reportEnteredAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
