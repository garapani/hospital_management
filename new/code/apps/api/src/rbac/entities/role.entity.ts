import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('roles')
export class Role {
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
