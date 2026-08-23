import { EntityManager } from 'typeorm';

/**
 * Acquires a transaction-scoped PostgreSQL advisory lock on a string key (hashed via `hashtext`).
 * The lock is held until the current transaction commits or rolls back.
 */
export async function withAdvisoryLock(
  manager: EntityManager,
  lockKey: string,
): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);
}
