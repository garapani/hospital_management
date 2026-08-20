import { Column, CreateDateColumn, Entity, PrimaryColumn, ManyToMany, JoinTable } from 'typeorm';
import { Role } from '../../rbac/entities/role.entity.js';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ type: 'varchar' })
  hospitalId!: string;

  @Column()
  hospitalName!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'suspended';

  /** The SaaS package this tenant was provisioned under; gates which module permissions its
   *  JWTs carry (see PackagesService.filterPermissions). New tenants default to 'basic'; rows
   *  that predate packages were migrated to 'enterprise'. */
  @Column({ type: 'varchar', default: 'basic' })
  packageCode!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @ManyToMany(() => Role)
  @JoinTable({
    name: 'tenant_roles',
    joinColumn: { name: 'tenantId', referencedColumnName: 'hospitalId' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' }
  })
  roles!: Role[];
}
