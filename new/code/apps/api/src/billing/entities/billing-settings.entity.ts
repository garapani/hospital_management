import { Column, Entity, PrimaryColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';
import { numericTransformer } from './numeric.transformer.js';

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

  /** Default GST rate applied to auto-captured (charge-capture) invoice lines; 0 = exempt. */
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numericTransformer })
  defaultTaxPercent!: number;
}
