import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create a radiology -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

@Entity('radiology_imaging_items')
export class RadiologyImagingItem extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  imagingTypeId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  procedureCode!: string | null;

  @Column({ type: 'int', default: 0 })
  displaySequence!: number;

  /** Selling price in INR; null = not priced (charge-capture skips unpriced items). */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  price!: number | null;
  /** Soft-delete flag: deactivated catalog entries stay visible to existing records but are rejected for new use. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
