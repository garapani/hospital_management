import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { TENANT_MIGRATIONS } from './migrations/index.js';

/**
 * A DataSource scoped to one tenant's schema via TypeORM's `schema` option — not a manually-run
 * `SET search_path` query, because `runMigrations()` opens its own internal connection that
 * wouldn't see a search_path set on a separately-created queryRunner. `schema` makes every
 * connection this DataSource creates default to the given schema, including that internal one.
 * TypeORM's migration-tracking table therefore lives inside that schema too, so re-running this
 * against an already-migrated tenant only applies migrations that specific schema hasn't seen yet.
 */
export function createTenantMigrationDataSource(schemaName: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    schema: schemaName,
    migrations: TENANT_MIGRATIONS,
    synchronize: false,
    extra: {
      connectionTimeoutMillis: 5000,
    },
  });
}
