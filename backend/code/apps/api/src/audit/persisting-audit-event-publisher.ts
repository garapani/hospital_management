import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AUDIT_DATA_SOURCE } from '../database/audit-data-source.js';
import { AuditRecord } from './entities/audit-record.entity.js';

@Injectable()
export class PersistingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(PersistingAuditEventPublisher.name);

  constructor(
    private readonly tenantConnection: TenantConnectionService,
    @Inject(AUDIT_DATA_SOURCE) private readonly auditDataSource: DataSource,
  ) {}

  /**
   * Always writes on a dedicated connection inside a real tenant-schema transaction, taken from
   * a **dedicated audit connection pool** (`AUDIT_DATA_SOURCE`) rather than the main pool — see
   * `audit-data-source.ts` for why: taking this second connection from the same pool as the
   * business transaction that triggered it risks pool starvation under concurrent load (mirrors
   * `PersistingReportingEventPublisher`'s identical fix for the same failure mode).
   *
   * The caller's EntityManager is deliberately NOT used: for saves of global (public-schema)
   * entities like `tenants`/`roles`/`packages`, that transaction's search_path is `public`, so an
   * unqualified `audit_records` insert used to land silently in a stale public copy of the table
   * and, since the public-schema cleanup, throws "relation does not exist" — which POISONS the
   * caller's transaction (a Postgres error aborts it even when the JS exception is caught).
   * Best-effort by design: a failure here must never roll back the business write, and an audit
   * row referencing a change that later rolls back (the orphan tradeoff) is the same accepted cost
   * the reporting publisher documents.
   */
  async publish(event: AuditEvent, _manager?: EntityManager): Promise<void> {
    try {
      await this.tenantConnection.runInTenantSchema(
        (m) => m.getRepository(AuditRecord).save(this.buildRecord(m, event)),
        this.auditDataSource,
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
