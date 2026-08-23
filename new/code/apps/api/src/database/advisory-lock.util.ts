import { EntityManager } from 'typeorm';

/**
 * Acquires a transaction-scoped PostgreSQL advisory lock.
 * Uses the 2-argument `pg_advisory_xact_lock(int4, int4)` when a colon-delimited namespace is present
 * (or when explicit namespace and key are provided), cleanly partitioning lock namespaces and
 * eliminating cross-resource 32-bit hash collision risks.
 */
export async function withAdvisoryLock(
  manager: EntityManager,
  lockKeyOrNamespace: string,
  key?: string,
): Promise<void> {
  if (key !== undefined) {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
      lockKeyOrNamespace,
      key,
    ]);
    return;
  }

  const colonIdx = lockKeyOrNamespace.indexOf(':');
  if (colonIdx !== -1) {
    const namespace = lockKeyOrNamespace.slice(0, colonIdx);
    const resourceKey = lockKeyOrNamespace.slice(colonIdx + 1);
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
      namespace,
      resourceKey,
    ]);
    return;
  }

  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKeyOrNamespace]);
}
