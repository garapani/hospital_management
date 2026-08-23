import { EntityManager } from 'typeorm';

/**
 * Acquires a transaction-scoped PostgreSQL advisory lock, keyed by `lockKey` (e.g.
 * `platform_billing:${tenantId}`). Always uses the single-argument `pg_advisory_xact_lock(bigint)`
 * form — deliberately, not the 2-argument `(int4, int4)` form: Postgres treats those as two
 * entirely separate lock spaces that never mutually exclude each other, so a rolling deploy with
 * an old-code instance still calling the 1-arg form and a new-code instance calling the 2-arg form
 * would silently stop serializing against each other. A hash collision on the 1-arg form's 64-bit
 * key is not a correctness risk either way — it just makes two unrelated resources serialize
 * against each other, never causes a missing lock — so there's no benefit to the 2-arg form worth
 * that deploy-window hazard.
 *
 * Must be called with a manager bound to an active transaction: `pg_advisory_xact_lock` outside an
 * explicit transaction runs (and releases) inside an implicit single-statement transaction, which
 * is a silent no-op as a mutual-exclusion mechanism.
 */
export async function withAdvisoryLock(manager: EntityManager, lockKey: string): Promise<void> {
  if (manager.queryRunner?.isTransactionActive !== true) {
    throw new Error(
      `withAdvisoryLock('${lockKey}') requires a manager bound to an active transaction — ` +
        'an advisory lock taken outside one releases immediately and locks nothing.',
    );
  }
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);
}
