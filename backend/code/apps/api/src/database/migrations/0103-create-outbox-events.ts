import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transactional outbox for the reporting-event and audit-record write paths (pending-tasks.md
 * "Reporting event outbox pattern", found in the 2026-09-03 external review). Both
 * `PersistingReportingEventPublisher` and `PersistingAuditEventPublisher` previously wrote
 * straight to `reporting_events`/`audit_records` on a dedicated connection, deliberately separate
 * from the business transaction that triggered them — that protected the business write from a
 * reporting/audit SQL failure, but accepted an orphan-row risk in the other direction: if the
 * business transaction later rolled back for an unrelated reason, the already-committed
 * reporting/audit row stayed behind, referencing a change that never persisted.
 *
 * This table closes that gap: both publishers now write here instead, on the SAME manager as the
 * business transaction (a plain single-table jsonb insert — intentionally almost impossible to
 * fail on its own, so accepting it inside the business transaction is a reasonable trade). A
 * separate `outbox-dispatcher` process drains `Pending` rows on its own connection, fully
 * decoupled from the business transaction by the time it runs, and materializes them into
 * `reporting_events`/`audit_records`.
 */
export class CreateOutboxEvents3000000000008 implements MigrationInterface {
  name = 'CreateOutboxEvents3000000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE outbox_events (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        kind character varying NOT NULL,
        payload jsonb NOT NULL,
        status character varying DEFAULT 'Pending' NOT NULL,
        attempts integer DEFAULT 0 NOT NULL,
        "lastError" text,
        "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
        "processedAt" timestamp with time zone,
        CONSTRAINT "PK_outbox_events" PRIMARY KEY (id)
      )
    `);
    // Partial index on the dispatcher's actual query shape (pending rows, oldest first) — a plain
    // index on status would also cover Processed/Failed rows the dispatcher never scans.
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_events_pending" ON outbox_events ("createdAt")
      WHERE status = 'Pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE outbox_events`);
  }
}
