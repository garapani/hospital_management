import { Column, Entity, PrimaryColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('billing_settings')
export class BillingSettings extends SoftDeletableEntity {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  id!: string;

  @Column({ type: 'varchar', length: 15 })
  gstin!: string;

  @Column({ type: 'varchar', length: 2 })
  stateCode!: string;

  @Column({ type: 'varchar' })
  hospitalLegalName!: string;
}
