import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';
import { createOutboxDispatchDataSource } from './outbox-dispatch-data-source.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity.js';
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';

const BATCH_SIZE = Number(process.env['OUTBOX_BATCH_SIZE'] ?? 50);
const MAX_ATTEMPTS = Number(process.env['OUTBOX_MAX_ATTEMPTS'] ?? 5);
const POLL_INTERVAL_MS = Number(process.env['OUTBOX_POLL_INTERVAL_MS'] ?? 5000);

/**
 * Materializes one outbox row into its target table, in the SAME transaction as marking the
 * outbox row Processed — so a crash between the two can never leave a row silently stuck as
 * Pending-but-already-materialized (which would double-write on the next pass) or
 * Processed-but-never-materialized.
 */
export async function processRow(dataSource: DataSource, row: OutboxEvent): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    // Re-read under a row lock: a second dispatcher instance (not how this ships today — one
    // `outbox-dispatcher` container — but cheap insurance) must never process the same row twice.
    const locked = await queryRunner.manager
      .getRepository(OutboxEvent)
      .findOne({ where: { id: row.id }, lock: { mode: 'pessimistic_write' } });
    if (!locked || locked.status !== 'Pending') {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
      return;
    }

    if (locked.kind === 'Reporting') {
      const payload = locked.payload as {
        eventType: string;
        entityId: string;
        payload: Record<string, unknown>;
        correlationId: string | null;
      };
      const repo = queryRunner.manager.getRepository(ReportingEvent);
      await repo.save(
        repo.create({
          eventType: payload.eventType,
          entityId: payload.entityId,
          payload: payload.payload,
          correlationId: payload.correlationId,
        }),
      );
    } else if (locked.kind === 'Audit') {
      const payload = locked.payload as {
        tableName: string;
        recordId: string;
        action: 'create' | 'update' | 'delete';
        changedByAccountId: string | null;
        correlationId: string | null;
        diff: unknown;
        occurredAt: string;
      };
      const repo = queryRunner.manager.getRepository(AuditRecord);
      await repo.save(
        repo.create({
          tableName: payload.tableName,
          recordId: payload.recordId,
          action: payload.action,
          changedByAccountId: payload.changedByAccountId,
          correlationId: payload.correlationId,
          diff: payload.diff,
          occurredAt: new Date(payload.occurredAt),
        }),
      );
    } else {
      throw new Error(`Unknown outbox event kind: ${locked.kind}`);
    }

    locked.status = 'Processed';
    locked.processedAt = new Date();
    await queryRunner.manager.getRepository(OutboxEvent).save(locked);
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
    // Attempt/failure bookkeeping happens on the main pool, after this queryRunner's own
    // connection is released back to it — reusing a connection for a second query before its
    // first one has fully finished releasing is what the "client is already executing a query"
    // warning flags, not just a cosmetic issue: it risks the two queries interleaving on state
    // that isn't actually safe to share.
    const attempts = row.attempts + 1;
    const lastError = error instanceof Error ? error.message : String(error);
    await dataSource.getRepository(OutboxEvent).update(row.id, {
      attempts,
      lastError,
      status: attempts >= MAX_ATTEMPTS ? 'Failed' : 'Pending',
    });
    console.error(`outbox-dispatcher: row ${row.id} (${row.kind}) failed (attempt ${attempts}): ${lastError}`);
    return;
  }
  await queryRunner.release();
}

/** Exported for tests: drains one tenant schema's pending outbox rows synchronously, so a spec
 *  can assert on the materialized reporting_events/audit_records row instead of polling. */
export async function dispatchTenant(schemaName: string): Promise<number> {
  const dataSource = createOutboxDispatchDataSource(schemaName);
  await dataSource.initialize();
  try {
    const [{ current_schema: currentSchema }]: { current_schema: string | null }[] =
      await dataSource.query('SELECT current_schema()');
    if (currentSchema !== schemaName) {
      return 0; // Purged/dropped since the registry snapshot — nothing to do.
    }

    const pending = await dataSource.getRepository(OutboxEvent).find({
      where: { status: 'Pending' },
      order: { createdAt: 'ASC' },
      take: BATCH_SIZE,
    });
    for (const row of pending) {
      await processRow(dataSource, row);
    }
    return pending.length;
  } finally {
    await dataSource.destroy();
  }
}

export async function dispatchOnce(): Promise<void> {
  const registryDataSource = createDataSource();
  await registryDataSource.initialize();
  let tenants: Tenant[];
  let existingSchemas: Set<string>;
  try {
    tenants = await registryDataSource.getRepository(Tenant).find();
    const schemaRows: { schema_name: string }[] = await registryDataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant\\_%'`,
    );
    existingSchemas = new Set(schemaRows.map((row) => row.schema_name));
  } finally {
    await registryDataSource.destroy();
  }

  let totalProcessed = 0;
  for (const tenant of tenants) {
    const schemaName = `tenant_${tenant.hospitalId}`;
    if (tenant.status === 'purged' || !existingSchemas.has(schemaName)) {
      continue;
    }
    totalProcessed += await dispatchTenant(schemaName);
  }
  if (totalProcessed > 0) {
    console.log(`outbox-dispatcher: processed ${totalProcessed} outbox row(s) across ${tenants.length} tenant(s).`);
  }
}

async function main(): Promise<void> {
  console.log(`outbox-dispatcher started. Polling every ${POLL_INTERVAL_MS}ms, batch size ${BATCH_SIZE}, max ${MAX_ATTEMPTS} attempts.`);
  // Runs forever (this is the container's whole process) — a failure in one poll cycle (e.g. a
  // transient DB connectivity blip while enumerating tenants) is logged and retried next cycle,
  // never crashes the container, matching backup-cron-entrypoint.sh's precedent for a long-running
  // scheduled service.
  for (;;) {
    try {
      await dispatchOnce();
    } catch (error) {
      console.error(`outbox-dispatcher: poll cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (process.argv[1]?.endsWith('outbox-dispatcher-entrypoint.js') || process.argv[1]?.endsWith('outbox-dispatcher-entrypoint.ts')) {
  main();
}
