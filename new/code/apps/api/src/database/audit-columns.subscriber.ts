import { Injectable } from '@nestjs/common';
import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AuditableEntity, SoftDeletableEntity } from './auditable.entity.js';

// Populates createdBy/updatedBy/deletedBy on any entity extending AuditableEntity. Wired the same
// way AuditSubscriber is (pushed onto dataSource.subscribers from a wiring service's
// onModuleInit(), not the TypeORM `subscribers:` DataSource-options array) so it fires identically
// for both the plain injected DataSource and TenantConnectionService.runInTenantSchema()'s
// queryRunner-scoped EntityManager — both come from the same DataSource instance.
//
// beforeInsert/beforeUpdate mutate event.entity — TypeORM's INSERT/UPDATE SQL is built from the
// full (possibly subscriber-mutated) entity, so this is the standard way to inject a computed
// column. beforeSoftRemove does NOT work the same way, despite looking parallel: TypeORM's
// softRemove() runs a narrow, purpose-built `softDelete()` query builder
// (SubjectExecutor.executeSoftRemoveOperations) that sets ONLY the @DeleteDateColumn — it never
// reads any other property off the entity, so mutating event.entity.deletedBy in a before-hook is
// silently discarded. deletedBy needs an explicit follow-up UPDATE after the soft-remove's own
// UPDATE has run, hence afterSoftRemove below instead.
@EventSubscriber()
@Injectable()
export class AuditColumnsSubscriber implements EntitySubscriberInterface {
  constructor(private readonly tenantContext: TenantContextService) {}

  // Only fills a field that's still unset. A handful of entities (Invoice, JournalEntry,
  // NursingTask) predate this subscriber and already resolve createdBy themselves in their
  // service layer (a resolveActor() helper with its own anti-spoofing checks — see e.g.
  // invoices.service.ts's "createdBy must never be null" comment) before the insert reaches
  // TypeORM; this subscriber must not overwrite an already-resolved value with a possibly
  // different one, so it only ever fills the gap for entities that don't set it themselves.
  beforeInsert(event: InsertEvent<unknown>): void {
    if (!(event.entity instanceof AuditableEntity)) {
      return;
    }
    const accountId = this.tenantContext.getAccountId() ?? null;
    if (event.entity.createdBy == null) {
      event.entity.createdBy = accountId;
    }
    if (event.entity.updatedBy == null) {
      event.entity.updatedBy = accountId;
    }
  }

  beforeUpdate(event: UpdateEvent<unknown>): void {
    if (!(event.entity instanceof AuditableEntity)) {
      return;
    }
    event.entity.updatedBy = this.tenantContext.getAccountId() ?? null;
  }

  async afterSoftRemove(event: SoftRemoveEvent<unknown>): Promise<void> {
    if (!(event.databaseEntity instanceof SoftDeletableEntity)) {
      return;
    }
    const accountId = this.tenantContext.getAccountId() ?? null;
    const primaryColumns = event.metadata.primaryColumns;
    const whereClause = primaryColumns
      .map((column, index) => `"${column.propertyName}" = $${index + 2}`)
      .join(' AND ');
    const whereValues = primaryColumns.map(
      (column) => (event.databaseEntity as Record<string, unknown>)[column.propertyName],
    );
    await event.manager.query(
      `UPDATE ${event.metadata.tableName} SET "deletedBy" = $1 WHERE ${whereClause}`,
      [accountId, ...whereValues],
    );
  }
}
