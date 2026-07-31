import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AuditRecord } from './entities/audit-record.entity.js';

@Injectable()
export class PersistingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(PersistingAuditEventPublisher.name);

  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async publish(event: AuditEvent, manager?: EntityManager): Promise<void> {
    try {
      if (manager) {
        await manager.getRepository(AuditRecord).save(this.buildRecord(manager, event));
        return;
      }
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
