import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('billing_settings')
export class BillingSettings {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  id!: string;

  @Column({ type: 'varchar', length: 15 })
  gstin!: string;

  @Column({ type: 'varchar', length: 2 })
  stateCode!: string;

  @Column({ type: 'varchar' })
  hospitalLegalName!: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;
}
