import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('billing_sequences')
export class BillingSequence {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  prefix!: string;

  @PrimaryColumn({ type: 'integer' })
  year!: number;

  @Column({ type: 'integer', default: 0 })
  lastSequence!: number;
}
