import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AuditRecord } from './entities/audit-record.entity.js';

@Injectable()
export class PersistingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(PersistingAuditEventPublisher.name);

  constructor(private readonly tenantConnection: TenantConnectionService) {}

  /**
   * Always writes on a dedicated connection inside a real tenant-schema transaction. The caller's
   * EntityManager is deliberately NOT used: for saves of global (public-schema) entities like
   * `tenants`/`roles`/`packages`, that transaction's search_path is `public`, so an unqualified
   * `audit_records` insert used to land silently in a stale public copy of the table and, since
   * the public-schema cleanup, throws "relation does not exist" — which POISONS the caller's
   * transaction (a Postgres error aborts it even when the JS exception is caught). Best-effort by
   * design: a failure here must never roll back the business write, and an audit row referencing a
   * change that later rolls back (the orphan tradeoff) is the same accepted cost the reporting
   * publisher documents.
   */
  async publish(event: AuditEvent, _manager?: EntityManager): Promise<void> {
    try {
      await this.tenantConnection.runInTenantSchema((m) =>
        m.getRepository(AuditRecord).save(this.buildRecord(m, event)),
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist audit record for ${event.tableName}/${event.recordId} (${event.action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private buildRecord(manager: EntityManager, event: AuditEvent): AuditRecord {
    return manager.getRepository(AuditRecord).create({
      tableName: event.tableName,
      recordId: event.recordId,
      action: event.action,
      changedByAccountId: event.changedByAccountId ?? null,
      correlationId: event.correlationId ?? null,
      diff: event.diff,
      occurredAt: new Date(event.occurredAt),
    });
  }
}
