import { Column, CreateDateColumn, Entity, PrimaryColumn, ManyToMany, JoinTable } from 'typeorm';
import { Role } from '../../rbac/entities/role.entity.js';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ type: 'varchar' })
  hospitalId!: string;

  @Column()
  hospitalName!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'suspended' | 'archived';

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

  /** When the tenant was archived (soft-delete). Archived tenants keep their schema and data,
   *  cannot log in, and can be restored or hard-purged. */
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  // Free-text actor field, not a uuid FK — can hold non-account values like 'ops.alice' or
  // 'seed-initial-setup' (see resolveActor() in tenants.service.ts). This is why Tenant does NOT
  // extend AuditableEntity (new/docs/superpowers/specs/2026-08-22-entity-audit-columns-design.md):
  // that base class's createdBy is a real uuid column, a genuine type mismatch here, not just a
  // duplicate-write risk. archivedAt above already fills the role a generic deletedAt would.
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
