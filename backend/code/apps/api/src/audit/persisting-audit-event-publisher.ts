import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity.js';

/**
 * Writes an `Audit`-kind outbox row on the SAME manager as the business transaction that
 * triggered it (`@hospital/audit-emitter`'s `AuditSubscriber` passes `event.manager` through) —
 * this row either commits or rolls back together with that transaction. Replaces the prior design
 * (an `audit_records` insert on a separate dedicated connection, `AUDIT_DATA_SOURCE`, kept
 * isolated so a SQL failure there couldn't abort the business write): that isolation traded away
 * the reverse guarantee, an already-committed audit row could reference a change that later
 * rolled back for an unrelated reason. See Development-Standards.md's outbox section and
 * `OutboxDispatcherService`/`outbox-dispatcher-entrypoint.ts`, which drains these rows on a
 * separate connection and materializes them into `audit_records`.
 *
 * `outbox_events` is a tenant-scoped table, so this can only be written when `manager`'s
 * connection actually has a tenant schema on its search_path — checked directly via
 * `current_schema()` (a side-effect-free builtin, safe to call regardless of outcome — unlike
 * attempting the insert and catching failure, which does NOT work: a Postgres error on ANY
 * statement poisons the rest of that transaction even when the JS exception is caught, so a
 * platform-level write would still silently degrade `COMMIT` into `ROLLBACK` afterwards). Every
 * JWT in this app carries a `hospitalId` claim regardless of whether the endpoint is tenant-scoped
 * or platform-admin (`TenantContextMiddleware` sets it unconditionally), so `event.hospitalId`
 * looked like a viable gate but is NOT — a platform-admin action (e.g. subscribing a tenant to a
 * package, `platform-billing`) still carries a `hospitalId` claim while writing platform entities
 * like `Subscription` on the main, `public`-schema-search-path connection. Skipping when the
 * schema isn't `tenant_*` matches *today's* actual behavior for that case (the old
 * dedicated-connection write already required a tenant context via
 * `TenantConnectionService.runInTenantSchema` and silently failed without one) — not a new gap,
 * just made an explicit precondition instead of an accidental side effect. For every genuinely
 * tenant-scoped write (the overwhelming majority), the insert itself is deliberately NOT wrapped
 * in a try/catch: it's a simple, low-risk row (no FKs, no business validation), and swallowing a
 * failure there would silently drop the event with no record it was ever meant to happen — worse
 * than the orphan-row risk this replaces.
 */
@Injectable()
export class PersistingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(PersistingAuditEventPublisher.name);

  async publish(event: AuditEvent, manager?: EntityManager): Promise<void> {
    if (!manager) {
      throw new Error(
        `PersistingAuditEventPublisher.publish requires a manager (${event.tableName}/${event.recordId})`,
      );
    }

    const [{ current_schema: schema }]: { current_schema: string | null }[] = await manager.query(
      'SELECT current_schema()',
    );
    if (!schema?.startsWith('tenant_')) {
      this.logger.warn(
        `Skipped audit event for ${event.tableName}/${event.recordId} (${event.action}): current schema "${schema}" is not a tenant schema (platform-level write — not yet supported).`,
      );
      return;
    }

    const repository = manager.getRepository(OutboxEvent);
    await repository.save(
      repository.create({
        kind: 'Audit',
        payload: {
          tableName: event.tableName,
          recordId: event.recordId,
          action: event.action,
          changedByAccountId: event.changedByAccountId ?? null,
          correlationId: event.correlationId ?? null,
          diff: event.diff,
          occurredAt: event.occurredAt,
        },
      }),
    );
  }
}
