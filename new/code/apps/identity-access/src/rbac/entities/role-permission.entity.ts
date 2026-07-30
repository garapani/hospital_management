import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  roleId!: string;

  @Column({ type: 'uuid' })
  permissionId!: string;
}
