import { Column, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from 'typeorm';

// Extended by every entity representing a real business/clinical/financial record (not join
// tables, append-only event logs, or numbering counters — see
// new/docs/superpowers/specs/2026-08-22-entity-audit-columns-design.md for the scoping rule).
// createdBy/updatedBy are plain nullable varchar columns with no FK to accounts, populated
// automatically by AuditColumnsSubscriber (apps/api/src/database/audit-columns.subscriber.ts),
// never set by service code directly.
//
// varchar, not uuid: matches the pre-existing convention on tenants.createdBy (a deliberately
// free-text actor field — see tenant.entity.ts). More importantly, TenantContextService.getAccountId()
// is populated straight from the JWT's `sub` claim (auth-context.middleware.ts) with no format
// validation — real logins always carry a genuine accounts.id uuid there, but this codebase's own
// test suite routinely signs tokens with human-readable sub values ('ops.alice',
// 'master-data-controller-admin', etc.), which a uuid-typed column would reject outright on the
// very first insert/update any such test performs. varchar accepts both without weakening anything
// meaningful — this is an audit-trail actor label, not a column anything joins against.
//
// Base tier: creation/modification tracking only, no delete-tracking columns. Use this directly
// for an entity that should never be removable through a normal delete action (only ever purged
// at the schema level, or genuinely immutable once created). Most entities want
// SoftDeletableEntity below instead — extend this one only when you specifically do NOT want
// delete tracking available.
export abstract class AuditableEntity {
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}

// Soft-delete tier: adds deletedAt/deletedBy on top of AuditableEntity. Extend this (not the
// bare AuditableEntity above) for any entity whose records can genuinely be deleted through a
// normal user action — which is most in-scope entities. Services must call
// repository.softRemove(entity), never repository.remove(entity), to get soft-delete behavior;
// the column's mere presence doesn't force it — remove() still hard-deletes even on an entity
// that has this column, so an entity that should support ONLY hard delete (rare — nothing in this
// codebase currently needs that) can still extend AuditableEntity directly and call remove().
//
// No separate isSoftDeleted flag: `deletedAt IS NOT NULL` is TypeORM's own soft-delete marker via
// @DeleteDateColumn — find()/query builder calls exclude soft-deleted rows by default.
export abstract class SoftDeletableEntity extends AuditableEntity {
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  deletedBy!: string | null;
}
