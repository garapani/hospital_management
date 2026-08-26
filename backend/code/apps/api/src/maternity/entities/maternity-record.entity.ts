import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

export type DeliveryType = 'Normal' | 'C-Section' | 'Instrumental';

/**
 * Labor/delivery record attached to an admission. Antenatal info on create; the delivery outcome
 * is filled in by recordDelivery.
 */
@Entity('maternity_records')
export class MaternityRecord extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  admissionId!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'int', default: 0 })
  gravida!: number;

  @Column({ type: 'int', default: 0 })
  para!: number;

  @Column({ type: 'date', nullable: true })
  lmp!: string | null;

  @Column({ type: 'date', nullable: true })
  edd!: string | null;

  @Column({ type: 'date', nullable: true })
  deliveryDate!: string | null;

  @Column({ type: 'varchar', nullable: true })
  deliveryType!: DeliveryType | null;

  @Column({ type: 'int', default: 0 })
  babyCount!: number;

  @Column({ type: 'text', nullable: true })
  complications!: string | null;

  /** Actor who recorded the delivery (see §25 — a clinical sign-off). */
  @Column({ type: 'uuid', nullable: true })
  deliveredBy!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
