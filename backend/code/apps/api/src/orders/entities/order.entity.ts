import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('orders')
export class Order extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceAppointmentId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceAdmissionId!: string | null;

  @Column({ type: 'uuid' })
  orderedBy!: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  orderedAt!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
