import 'reflect-metadata';
import { createDataSource } from './data-source.js';
import { createTenantMigrationDataSource } from './tenant-migration-data-source.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';

/**
 * Applies every TENANT_MIGRATIONS entry a given tenant schema hasn't already applied. TypeORM's
 * per-schema migration tracking (via createTenantMigrationDataSource's search_path option) means
 * this is safe to run repeatedly and against every tenant at once — the gap this closes: rolling
 * out a new migration to every already-provisioned tenant becomes one command, not a manual
 * per-schema operation.
 *
 * Purged tenants (status='purged', see migration 0056) are tombstone rows: purgeTenant() drops
 * their schema/role but keeps the registry row to block hospitalId reuse. Without a guard here,
 * createTenantMigrationDataSource's `-c search_path=<schema>,public` falls through to `public`
 * for a tombstone (the schema no longer exists), so TypeORM would create its migrations tracking
 * table in `public` and replay every tenant migration against it until one fails on a table that
 * doesn't exist there. Active/suspended/archived tenants all keep their schema and data (see
 * Tenant.archivedAt / Tenant.purgedAt doc comments) and so still receive pending migrations.
 *
 * Guarded three ways, because status='purged' is not the only way a schema can go missing and a
 * single upfront check has a TOCTOU gap once this loop is migrating many tenants in sequence:
 *  1. Purged tenants are skipped outright before opening a connection for them at all.
 *  2. A cheap upfront `information_schema.schemata` snapshot (fetched once, off the registry
 *     connection) skips any tenant with no live schema at loop start — cheap enough to avoid
 *     ever spinning up a per-tenant DataSource for the common case.
 *  3. The authoritative guard: immediately after connecting each tenant's migration DataSource,
 *     `SELECT current_schema()` — which Postgres resolves to the first schema in search_path that
 *     actually exists, skipping ones that don't — must equal the expected schema, or migrations
 *     never run for it. This is what actually closes the race: (2) is a snapshot taken before the
 *     loop starts, so a schema dropped by a concurrent purge *during* the loop (this runner has no
 *     lock over other tenants' purges) would still slip past it; (3) re-checks right at the point
 *     of use, immediately before runMigrations() could write anything.
 */
export async function runTenantMigrations(): Promise<{ tenantsProcessed: number; tenantsSkipped: string[] }> {
  const registryDataSource = createDataSource();
  await registryDataSource.initialize();
  let tenants: Tenant[];
  let existingSchemas: Set<string>;
  try {
    tenants = await registryDataSource.getRepository(Tenant).find();
    const schemaRows: { schema_name: string }[] = await registryDataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant\\_%'`,
    );
    existingSchemas = new Set(schemaRows.map((row) => row.schema_name));
  } finally {
    await registryDataSource.destroy();
  }

  let processed = 0;
  const skipped: string[] = [];
  for (const tenant of tenants) {
    const schemaName = `tenant_${tenant.hospitalId}`;
    if (tenant.status === 'purged' || !existingSchemas.has(schemaName)) {
      skipped.push(tenant.hospitalId);
      continue;
    }

    const migrationDataSource = createTenantMigrationDataSource(schemaName);
    await migrationDataSource.initialize();
    try {
      const [{ current_schema: currentSchema }]: { current_schema: string | null }[] =
        await migrationDataSource.query('SELECT current_schema()');
      if (currentSchema !== schemaName) {
        skipped.push(tenant.hospitalId);
        continue;
      }
      await migrationDataSource.runMigrations({ transaction: 'each' });
    } finally {
      await migrationDataSource.destroy();
    }
    processed += 1;
  }

  return { tenantsProcessed: processed, tenantsSkipped: skipped };
}

async function main(): Promise<void> {
  const { tenantsProcessed, tenantsSkipped } = await runTenantMigrations();
  console.log(`migrate-tenants: applied pending migrations across ${tenantsProcessed} tenant schema(s).`);
  if (tenantsSkipped.length > 0) {
    console.log(`migrate-tenants: skipped ${tenantsSkipped.length} tenant(s) with no live schema: ${tenantsSkipped.join(', ')}`);
  }
}

if (process.argv[1]?.endsWith('migrate-tenants.js') || process.argv[1]?.endsWith('migrate-tenants.ts')) {
  // Explicit process.exit(0) is load-bearing: see the identical note in migrate.ts — the swc-node
  // ESM loader's worker IPC pipes and data-source.ts's pool-monitor setInterval keep the event
  // loop alive after the work completes, so without it the command hangs despite finishing.
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
