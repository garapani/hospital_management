import { getAuditExcludedFields } from './audit-exclude.decorator.js';
import type { EntityClass } from './audit-exclude.decorator.js';

export interface AuditDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export function buildAuditDiff(
  entityClass: EntityClass,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditDiffEntry[] {
  const excluded = new Set(getAuditExcludedFields(entityClass));
  excluded.add('id');
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  const diff: AuditDiffEntry[] = [];
  for (const field of fields) {
    if (excluded.has(field)) {
      continue;
    }
    const beforeValue = before ? before[field] : null;
    const afterValue = after ? after[field] : null;
    if (beforeValue !== afterValue) {
      diff.push({ field, before: beforeValue ?? null, after: afterValue ?? null });
    }
  }
  return diff;
}
