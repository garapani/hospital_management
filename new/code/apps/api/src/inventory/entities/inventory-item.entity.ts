import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) subCategoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar' }) code!: string;
  @Column({ type: 'varchar' }) unitOfMeasure!: string;
  @Column({ type: 'numeric', default: 0 }) reorderLevel!: string;
  @Column({ type: 'numeric', default: 0 }) minimumStock!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
