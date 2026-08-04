import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { TENANT_MIGRATIONS } from './migrations/index.js';

/**
 * A DataSource scoped to one tenant's schema via a Postgres startup option (`-c search_path=...`),
 * not TypeORM's `schema` DataSourceOption — that option only affects how TypeORM generates
 * entity-qualified SQL for repositories/QueryBuilder, it does NOT set the actual session
 * search_path, so raw `queryRunner.query()` calls inside migration `.up()` methods (unqualified
 * `CREATE TABLE accounts`) would still resolve against `public`. `-c search_path=...` is a
 * Postgres connection-startup parameter (via node-postgres's `options` field) that applies at the
 * protocol level to every connection this DataSource opens, including the internal one
 * `runMigrations()` creates for itself — so TypeORM's migration-tracking table ends up inside that
 * schema too, and re-running this against an already-migrated tenant only applies migrations that
 * specific schema hasn't seen yet. Safe to interpolate unquoted: `schemaName` is always
 * `tenant_<id>` where `<id>` was already validated against `/^[a-z0-9_]+$/` by the caller.
 */
export function createTenantMigrationDataSource(schemaName: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    migrations: TENANT_MIGRATIONS,
    synchronize: false,
    extra: {
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schemaName},public`,
    },
  });
}
