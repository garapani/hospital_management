import { Injectable, Logger } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';

/**
 * Writes reporting events on a **separate database connection** (via
 * `TenantConnectionService.runInTenantSchema`), never on the `EntityManager` of the business
 * transaction that triggered them. A Postgres-level failure on the `reporting_events` INSERT
 * (missing table, constraint violation, disk full) aborts whatever transaction it runs in, and
 * Postgres then refuses every further statement on that transaction — including the business
 * row's COMMIT. Catching the JS exception cannot undo that; only a separate connection can.
 * See the Global Constraint in `new/docs/superpowers/plans/2026-08-01-reporting-archiver.md`:
 * "Failed reporting-archive write must never roll back or block the real business transaction."
 *
 * Accepted tradeoff: that constraint is one-directional. Because the reporting write commits on
 * its own connection while the business transaction is still open, a business transaction that
 * later rolls back for an unrelated reason leaves an orphan `reporting_events` row referencing an
 * entity that never persisted. This is deliberate — the reverse guarantee is out of scope.
 */
@Injectable()
export class PersistingReportingEventPublisher {
  private readonly logger = new Logger(PersistingReportingEventPublisher.name);

  constructor(
    private readonly tenantConnectionService: TenantConnectionService,
  ) {}

  async publish(eventData: Partial<ReportingEvent>): Promise<void> {
    try {
      await this.tenantConnectionService.runInTenantSchema(async (manager) => {
        const repository = manager.getRepository(ReportingEvent);
        await repository.save(repository.create(eventData));
      });
    } catch (error) {
      // Swallows both the SQL error and `runInTenantSchema`'s own errors (e.g. no tenant
      // context set). Never rethrow: the caller is a TypeORM subscriber running inside the
      // business transaction.
      this.logger.error(
        `Failed to persist reporting event ${eventData.eventType} for entity ${eventData.entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
