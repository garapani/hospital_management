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
 */
export async function runTenantMigrations(): Promise<{ tenantsProcessed: number }> {
  const registryDataSource = createDataSource();
  await registryDataSource.initialize();
  let tenants: Tenant[];
  try {
    tenants = await registryDataSource.getRepository(Tenant).find();
  } finally {
    await registryDataSource.destroy();
  }

  for (const tenant of tenants) {
    const schemaName = `tenant_${tenant.hospitalId}`;
    const migrationDataSource = createTenantMigrationDataSource(schemaName);
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.runMigrations({ transaction: 'each' });
    } finally {
      await migrationDataSource.destroy();
    }
  }

  return { tenantsProcessed: tenants.length };
}

async function main(): Promise<void> {
  const { tenantsProcessed } = await runTenantMigrations();
  console.log(`migrate-tenants: applied pending migrations across ${tenantsProcessed} tenant schema(s).`);
}

if (process.argv[1]?.endsWith('migrate-tenants.js') || process.argv[1]?.endsWith('migrate-tenants.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
