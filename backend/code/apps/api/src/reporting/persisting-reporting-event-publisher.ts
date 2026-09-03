import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';

/**
 * Writes a `Reporting`-kind outbox row on the SAME manager as the business transaction that
 * triggered it (see `ReportingSubscriber.afterInsert`, which passes `event.manager`) — this row
 * either commits or rolls back together with that transaction, unlike the prior design (a
 * `reporting_events` insert on a separate dedicated connection, kept isolated so a SQL failure
 * there couldn't abort the business write). That isolation traded away the reverse guarantee: an
 * already-committed reporting row could reference a business change that later rolled back for an
 * unrelated reason. See Development-Standards.md's outbox section and
 * `OutboxDispatcherService`/`outbox-dispatcher-entrypoint.ts`, which drains these rows on a
 * separate connection and materializes them into `reporting_events`.
 *
 * Deliberately not wrapped in a try/catch: the whole point of the outbox is that this insert is
 * simple and low-risk enough to trust inside the business transaction (no FKs, no business
 * validation, just an id/kind/payload/status row) — swallowing a failure here would silently drop
 * the event with no record it was ever meant to happen, which is worse than the orphan-row risk
 * this replaces.
 */
@Injectable()
export class PersistingReportingEventPublisher {
  async publish(eventData: Partial<ReportingEvent>, manager: EntityManager): Promise<void> {
    const repository = manager.getRepository(OutboxEvent);
    await repository.save(
      repository.create({
        kind: 'Reporting',
        payload: {
          eventType: eventData.eventType,
          entityId: eventData.entityId,
          payload: eventData.payload,
          correlationId: eventData.correlationId ?? null,
        },
      }),
    );
  }
}
