import { AuditDiffEntry } from './build-audit-diff.js';

export interface AuditEvent {
  tableName: string;
  recordId: string;
  action: 'create' | 'update' | 'delete';
  hospitalId?: string;
  changedByAccountId?: string;
  correlationId?: string;
  diff: AuditDiffEntry[];
  occurredAt: string;
}

export interface AuditEventPublisher {
  publish(event: AuditEvent): Promise<void>;
}

export const AUDIT_EVENT_PUBLISHER = Symbol('AUDIT_EVENT_PUBLISHER');
