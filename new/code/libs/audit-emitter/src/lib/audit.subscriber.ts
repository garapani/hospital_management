import { Inject, Injectable } from '@nestjs/common';
import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { buildAuditDiff } from './build-audit-diff.js';
import { AUDIT_EVENT_PUBLISHER, AuditEventPublisher } from './audit-event-publisher.interface.js';

type EntityAction = 'create' | 'update' | 'delete';

@EventSubscriber()
@Injectable()
export class AuditSubscriber implements EntitySubscriberInterface {
  constructor(
    @Inject(AUDIT_EVENT_PUBLISHER) private readonly publisher: AuditEventPublisher,
    private readonly tenantContext: TenantContextService,
  ) {}

  async afterInsert(event: InsertEvent<Record<string, unknown>>): Promise<void> {
    await this.emit('create', event.metadata.tableName, event.entity, null, event.entity ?? null);
  }

  async afterUpdate(event: UpdateEvent<Record<string, unknown>>): Promise<void> {
    await this.emit(
      'update',
      event.metadata.tableName,
      event.entity ?? event.databaseEntity,
      (event.databaseEntity as Record<string, unknown>) ?? null,
      (event.entity as Record<string, unknown>) ?? null,
    );
  }

  async afterRemove(event: RemoveEvent<Record<string, unknown>>): Promise<void> {
    await this.emit(
      'delete',
      event.metadata.tableName,
      event.databaseEntity,
      (event.databaseEntity as Record<string, unknown>) ?? null,
      null,
    );
  }

  private async emit(
    action: EntityAction,
    tableName: string,
    entityForId: Record<string, unknown> | undefined,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    const entityClass = ((before ?? after)?.constructor ?? Object) as () => void;
    const diff = buildAuditDiff(entityClass, before, after);
    if (diff.length === 0) {
      return;
    }

    await this.publisher.publish({
      tableName,
      recordId: String(entityForId?.['id'] ?? ''),
      action,
      hospitalId: this.tenantContext.getTenantId(),
      changedByAccountId: this.tenantContext.getAccountId(),
      correlationId: this.tenantContext.getCorrelationId(),
      diff,
      occurredAt: new Date().toISOString(),
    });
  }
}
