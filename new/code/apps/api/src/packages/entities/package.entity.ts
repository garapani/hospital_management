import { Column, Entity, PrimaryColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

/** A SaaS package (public-schema catalog row, like roles/permissions). See package-catalog.ts. */
@Entity('packages')
export class Package extends SoftDeletableEntity {
  @PrimaryColumn({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb' })
  modules!: string[];
}
