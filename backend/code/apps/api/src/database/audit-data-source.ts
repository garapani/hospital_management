import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';

/**
 * DI token for the dedicated audit `DataSource`. Kept internal to `AuditModule` — nothing outside
 * the audit slice should be writing on this pool.
 */
export const AUDIT_DATA_SOURCE = Symbol('AUDIT_DATA_SOURCE');

/**
 * A **second, dedicated connection pool** for audit-record writes, deliberately separate from the
 * main `DataSource` created by `createDataSource()` — mirrors `createReportingDataSource()`
 * (see `reporting-data-source.ts` for the full rationale) for the identical reason: audit writes
 * fire from `AuditSubscriber.afterInsert`/`afterUpdate` while the triggering business transaction
 * still holds a connection from the main pool. Taking the audit write's connection from that same
 * pool means a request can hold its business connection while waiting for a second one to log the
 * audit row — at pool capacity that deadlocks the whole API forever (node-postgres defaults to
 * `connectionTimeoutMillis: 0`, wait indefinitely). This pool removes that coupling: it can never
 * consume a connection a business query needs, and `connectionTimeoutMillis: 2000` turns
 * audit-side exhaustion into a thrown error the publisher's try/catch already swallows and logs.
 *
 * Same Postgres credentials as the main pool; only `AuditRecord` is mapped, and it never runs
 * migrations (the main pool owns schema changes).
 */
export function createAuditDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'hospital_db_user',
    password: process.env['DB_PASSWORD'] ?? 'hospital_db_password',
    database: process.env['DB_DATABASE'] ?? 'hospital_db',
    entities: [AuditRecord],
    migrations: [],
    synchronize: false,
    extra: {
      max: 3,
      connectionTimeoutMillis: 2000,
    },
  });
}
