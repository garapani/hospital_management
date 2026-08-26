import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { REPORTING_DATA_SOURCE } from '../database/reporting-data-source.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';

/**
 * Writes reporting events on a **separate database connection**, taken from a **dedicated
 * reporting connection pool** (`REPORTING_DATA_SOURCE`), never on the `EntityManager` of the
 * business transaction that triggered them.
 *
 * A Postgres-level failure on the `reporting_events` INSERT (missing table, constraint violation,
 * disk full) aborts whatever transaction it runs in, and Postgres then rejects every further
 * statement on that transaction. The COMMIT is not rejected outright — Postgres silently accepts
 * it and performs a ROLLBACK instead, which is worse: the application sees an apparently
 * successful commit while the business row is gone. Catching the JS exception cannot undo that;
 * only a separate connection can.
 * See the Global Constraint in `new/docs/superpowers/plans/2026-08-01-reporting-archiver.md`:
 * "Failed reporting-archive write must never roll back or block the real business transaction."
 *
 * The pool must be a *dedicated* one rather than the main pool: taking the second connection from
 * the same pool that holds the business connection lets concurrent requests exhaust it and wait on
 * each other forever. `createReportingDataSource()` caps this pool and gives it a finite
 * acquisition timeout, so exhaustion surfaces as a thrown error caught below.
 *
 * Accepted tradeoff: the constraint is one-directional. `runInTenantSchema` opens no explicit
 * transaction, so the reporting row is committed by the single implicit transaction TypeORM wraps
 * around that one `save()`. If the business transaction later rolls back for an unrelated reason,
 * that already-committed row is an orphan referencing an entity that never persisted. This is
 * deliberate — the reverse guarantee is out of scope.
 */
@Injectable()
export class PersistingReportingEventPublisher {
  private readonly logger = new Logger(PersistingReportingEventPublisher.name);

  constructor(
    private readonly tenantConnectionService: TenantConnectionService,
    @Inject(REPORTING_DATA_SOURCE)
    private readonly reportingDataSource: DataSource,
  ) {}

  async publish(eventData: Partial<ReportingEvent>): Promise<void> {
    try {
      await this.tenantConnectionService.runInTenantSchema(async (manager) => {
        const repository = manager.getRepository(ReportingEvent);
        await repository.save(repository.create(eventData));
      }, this.reportingDataSource);
    } catch (error) {
      // Swallows both the SQL error and `runInTenantSchema`'s own errors (e.g. no tenant
      // context set, or a reporting-pool connection-acquisition timeout). Never rethrow: the
      // caller is a TypeORM subscriber running inside the business transaction.
      this.logger.error(
        `Failed to persist reporting event ${eventData.eventType} for entity ${eventData.entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
