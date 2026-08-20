import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create an inventory -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) subCategoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar' }) code!: string;
  @Column({ type: 'varchar' }) unitOfMeasure!: string;
  @Column({ type: 'numeric', default: 0 }) reorderLevel!: string;
  @Column({ type: 'numeric', default: 0 }) minimumStock!: string;
  /** Selling price in INR (e.g. a drug's retail price); null = not priced. */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  salePrice!: number | null;
  /** Soft-delete flag: deactivated catalog entries stay visible to existing records but are rejected for new use. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;


  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
