import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('roles')
export class Role extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  name!: string;

  @Column({ type: 'varchar' })
  description!: string;

  @Column({ type: 'int', default: 0 })
  priority!: number;

  @Column({ type: 'boolean', default: false })
  bypassesPermissionChecks!: boolean;

  @Column({ type: 'boolean', default: false })
  isCrossTenant!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
