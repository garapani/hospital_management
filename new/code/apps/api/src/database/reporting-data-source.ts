import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';

/**
 * DI token for the dedicated reporting `DataSource`. Kept internal to `ReportingModule` —
 * nothing outside the reporting slice should be writing on this pool.
 */
export const REPORTING_DATA_SOURCE = Symbol('REPORTING_DATA_SOURCE');

/**
 * A **second, dedicated connection pool** for reporting-archive writes, deliberately separate
 * from the main `DataSource` created by `createDataSource()`.
 *
 * Reporting events are written on their own connection (see `PersistingReportingEventPublisher`)
 * so a SQL failure on `reporting_events` cannot abort the business transaction. Taking that second
 * connection from the *main* pool, however, means a request can hold its business connection while
 * waiting for a reporting connection from the same pool — at pool capacity that deadlocks the whole
 * API forever, because node-postgres defaults to `connectionTimeoutMillis: 0` (wait indefinitely).
 *
 * This pool removes that coupling entirely:
 * - it can never consume a connection a business query needs, and
 * - `connectionTimeoutMillis: 2000` turns reporting-side exhaustion into a thrown error that the
 *   publisher's try/catch swallows and logs, instead of an unbounded hang. Kept short (vs. the
 *   main pool's 5000ms) because reporting is a best-effort archive path: a business write should
 *   not sit waiting on it any longer than necessary before the archive attempt gives up.
 *
 * Same Postgres credentials as the main pool; only `ReportingEvent` is mapped, and it never runs
 * migrations (the main pool owns schema changes).
 */
export function createReportingDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'hospital_db_user',
    password: process.env['DB_PASSWORD'] ?? 'hospital_db_password',
    database: process.env['DB_DATABASE'] ?? 'hospital_db',
    entities: [ReportingEvent],
    migrations: [],
    synchronize: false,
    extra: {
      max: 3,
      connectionTimeoutMillis: 2000,
    },
  });
}
