import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create a fixed-assets -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

export type FixedAssetCondition = 'In Service' | 'Under Repair' | 'Retired';
export const FIXED_ASSET_CONDITIONS: FixedAssetCondition[] = ['In Service', 'Under Repair', 'Retired'];

/**
 * Asset register entry. Depreciation (straight-line) is computed on read — the accumulated amount
 * and book value are not stored columns, so a read always reflects the current date; see
 * FixedAssetsService.getAssetValuation.
 */
@Entity('fixed_assets')
export class FixedAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  assetCode!: string;

  @Column({ type: 'uuid' })
  categoryId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'date' })
  purchaseDate!: string;

  /** Purchase cost in INR. */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  purchaseCost!: number;

  @Column({ type: 'varchar', nullable: true })
  supplierName!: string | null;

  /** Master-data department the asset is assigned to (null = unassigned). */
  @Column({ type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ type: 'varchar', default: 'In Service' })
  condition!: FixedAssetCondition;

  @Column({ type: 'varchar', default: 'straight-line' })
  depreciationMethod!: string;

  /** Required for depreciation; null = no depreciation is accrued. */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer })
  usefulLifeYears!: number | null;

  /** Residual value at end of useful life, in INR. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  salvageValue!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
