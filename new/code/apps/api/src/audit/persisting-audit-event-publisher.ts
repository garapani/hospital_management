import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AuditRecord } from './entities/audit-record.entity.js';

@Injectable()
export class PersistingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(PersistingAuditEventPublisher.name);

  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async publish(event: AuditEvent): Promise<void> {
    try {
      await this.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(AuditRecord).save(
          manager.getRepository(AuditRecord).create({
            tableName: event.tableName,
            recordId: event.recordId,
            action: event.action,
            changedByAccountId: event.changedByAccountId ?? null,
            correlationId: event.correlationId ?? null,
            diff: event.diff,
            occurredAt: new Date(event.occurredAt),
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist audit record for ${event.tableName}/${event.recordId} (${event.action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
