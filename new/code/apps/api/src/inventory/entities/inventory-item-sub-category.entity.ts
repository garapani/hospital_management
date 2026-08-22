import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('inventory_item_sub_categories')
export class InventoryItemSubCategory extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) categoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'boolean', default: false }) isConsumable!: boolean;
  /** Soft-delete flag: deactivated catalog entries stay visible to existing records but are rejected for new use. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
