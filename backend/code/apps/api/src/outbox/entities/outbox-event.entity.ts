import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AuditExcludeEntity } from '@hospital/audit-emitter';

/**
 * Transactional outbox row: written on the SAME manager/transaction as the business change that
 * triggered it (ReportingSubscriber/AuditSubscriber's `event.manager`), guaranteeing it either
 * commits or rolls back together with that change — unlike writing straight to `reporting_events`/
 * `audit_records` on a separate connection (the prior design), which protected the business
 * transaction from a reporting/audit write failure but could leave an orphan row referencing a
 * change that never persisted. See Development-Standards.md's outbox section for the full
 * rationale and the failure mode this replaces.
 *
 * `OutboxDispatcherService` (a separate process — the `outbox-dispatcher` compose service) drains
 * `Pending` rows and materializes them into `reporting_events`/`audit_records`, on its own
 * connection, entirely decoupled from any business transaction by the time it runs.
 */
@Entity('outbox_events')
@AuditExcludeEntity()
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  kind!: 'Reporting' | 'Audit';

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', default: 'Pending' })
  status!: 'Pending' | 'Processed' | 'Failed';

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}
