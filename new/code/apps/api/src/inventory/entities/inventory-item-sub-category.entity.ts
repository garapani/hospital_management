import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_item_sub_categories')
export class InventoryItemSubCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) categoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'boolean', default: false }) isConsumable!: boolean;
  /** Soft-delete flag: deactivated catalog entries stay visible to existing records but are rejected for new use. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;


  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
