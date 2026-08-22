import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from './numeric.transformer.js';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('deposits')
export class Deposit extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  balance!: number;

  @Column({ type: 'uuid' })
  receivedBy!: string;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  receivedAt!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  refundedBy!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  refundedAt!: Date | null;
}
