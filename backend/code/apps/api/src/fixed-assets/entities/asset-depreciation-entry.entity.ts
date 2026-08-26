import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create a fixed-assets -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

/**
 * One period's straight-line depreciation charge for one asset — a persisted accrual record,
 * distinct from `FixedAssetsService.getAssetValuation`'s stateless read-time calculation.
 * `accumulatedDepreciation`/`bookValue` are snapshots as of the end of this period, so the
 * register/valuation reads don't need to replay every prior period's entries to know where an
 * asset stands. See `FixedAssetsService.runDepreciationAccrual`.
 */
@Entity('asset_depreciation_entries')
@Unique(['assetId', 'periodMonth', 'periodYear'])
export class AssetDepreciationEntry extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  assetId!: string;

  @Column({ type: 'int' })
  periodMonth!: number;

  @Column({ type: 'int' })
  periodYear!: number;

  /** This period's depreciation charge (may be 0 for an already-fully-depreciated asset). */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  depreciationAmount!: number;

  /** Cumulative depreciation as of the end of this period. */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  accumulatedDepreciation!: number;

  /** purchaseCost - accumulatedDepreciation, as of the end of this period. */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  bookValue!: number;

  /** Actor who ran the accrual (see §25) — distinct from the generic createdBy audit column. */
  @Column({ type: 'uuid' })
  accruedBy!: string;
}
