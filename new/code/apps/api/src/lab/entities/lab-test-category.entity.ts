import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('lab_test_categories')
export class LabTestCategory extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'int', default: 0 })
  displaySequence!: number;
  /** Soft-delete flag: deactivated catalog entries stay visible to existing records but are rejected for new use. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
