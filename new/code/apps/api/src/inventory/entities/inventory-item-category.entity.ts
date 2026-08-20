import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_item_categories')
export class InventoryItemCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'int', default: 0 }) displaySequence!: number;
  /** Soft-delete flag: deactivated catalog entries stay visible to existing records but are rejected for new use. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;


  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
