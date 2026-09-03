import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity.js';
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';

const SAFE_SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;

/**
 * A DataSource scoped to one tenant's schema via the Postgres startup `-c search_path=...` option
 * (same technique as `createTenantMigrationDataSource` — see its doc comment for why this, not
 * TypeORM's `schema` option, is required for raw/unqualified SQL to resolve correctly), used by
 * `outbox-dispatcher-entrypoint.ts` to read `outbox_events` and materialize rows into
 * `reporting_events`/`audit_records`, all within that one tenant's schema. Entirely separate from
 * `REPORTING_DATA_SOURCE`/`AUDIT_DATA_SOURCE` (the API process's dedicated pools) — this runs in
 * its own container/process on its own connection, so there's no shared-pool starvation risk to
 * design around here.
 */
export function createOutboxDispatchDataSource(schemaName: string): DataSource {
  if (!SAFE_SCHEMA_NAME.test(schemaName)) {
    throw new Error(`Refusing to use unsafe schema name: ${schemaName}`);
  }
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'hospital_db_user',
    password: process.env['DB_PASSWORD'] ?? 'hospital_db_password',
    database: process.env['DB_DATABASE'] ?? 'hospital_db',
    entities: [OutboxEvent, ReportingEvent, AuditRecord],
    migrations: [],
    synchronize: false,
    extra: {
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schemaName},public`,
    },
  });
}
