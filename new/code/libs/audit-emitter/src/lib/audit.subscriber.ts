import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import type { EntityManager } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { buildAuditDiff } from './build-audit-diff.js';
import { isAuditExcludedEntity } from './audit-exclude.decorator.js';
import type { EntityClass } from './audit-exclude.decorator.js';
import { AUDIT_EVENT_PUBLISHER } from './audit-event-publisher.interface.js';
import type { AuditEventPublisher } from './audit-event-publisher.interface.js';

type EntityAction = 'create' | 'update' | 'delete';

@EventSubscriber()
@Injectable()
export class AuditSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(AuditSubscriber.name);

  constructor(
    @Inject(AUDIT_EVENT_PUBLISHER)
    private readonly publisher: AuditEventPublisher,
    private readonly tenantContext: TenantContextService,
  ) {}

  async afterInsert(
    event: InsertEvent<Record<string, unknown>>,
  ): Promise<void> {
    await this.emit(
      'create',
      event.metadata?.tableName ?? '',
      event.entity,
      null,
      event.entity ?? null,
      event.manager,
      event.metadata?.primaryColumns?.map((column) => column.propertyName) ?? ['id'],
    );
  }

  async afterUpdate(
    event: UpdateEvent<Record<string, unknown>>,
  ): Promise<void> {
    await this.emit(
      'update',
      event.metadata?.tableName ?? '',
      event.entity ?? event.databaseEntity,
      (event.databaseEntity as Record<string, unknown>) ?? null,
      (event.entity as Record<string, unknown>) ?? null,
      event.manager,
      event.metadata?.primaryColumns?.map((column) => column.propertyName) ?? ['id'],
    );
  }

  async afterRemove(
    event: RemoveEvent<Record<string, unknown>>,
  ): Promise<void> {
    await this.emit(
      'delete',
      event.metadata?.tableName ?? '',
      event.databaseEntity,
      (event.databaseEntity as Record<string, unknown>) ?? null,
      null,
      event.manager,
      event.metadata?.primaryColumns?.map((column) => column.propertyName) ?? ['id'],
    );
  }

  private async emit(
    action: EntityAction,
    tableName: string,
    entityForId: Record<string, unknown> | undefined,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    manager: EntityManager,
    primaryKeyPropertyNames: string[],
  ): Promise<void> {
    const resolvedClass = (before ?? after)?.constructor;
    if (resolvedClass === undefined || resolvedClass === Object) {
      this.logger.warn(
        `Skipped audit event for table "${tableName}" (action: ${action}): entity class could not be determined, so sensitive-field exclusion could not be verified.`,
      );
      return;
    }
    const entityClass = resolvedClass as EntityClass;
    if (isAuditExcludedEntity(entityClass)) {
      return;
    }
    const diff = buildAuditDiff(entityClass, before, after);
    if (diff.length === 0) {
      return;
    }

    // Resolve the record id from the entity's real primary key columns, not a hardcoded 'id' —
    // entities whose key is named differently (e.g. Tenant.hospitalId) otherwise get an empty
    // recordId and their audit rows can't be correlated back to the record.
    const recordId = primaryKeyPropertyNames
      .map((propertyName) => entityForId?.[propertyName])
      .filter((value) => value !== undefined && value !== null)
      .join(':');

    await this.publisher.publish(
      {
        tableName,
        recordId,
        action,
        hospitalId: this.tenantContext.getTenantId(),
        changedByAccountId: this.tenantContext.getAccountId(),
        correlationId: this.tenantContext.getCorrelationId(),
        diff,
        occurredAt: new Date().toISOString(),
      },
      manager,
    );
  }
}
