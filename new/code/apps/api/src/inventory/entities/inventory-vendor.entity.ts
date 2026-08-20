import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_vendors')
export class InventoryVendor {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', nullable: true }) contactPerson!: string | null;
  @Column({ type: 'varchar', nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', nullable: true }) address!: string | null;
  /** Soft-delete flag: deactivated catalog entries stay visible to existing records but are rejected for new use. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;


  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
