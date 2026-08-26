import 'reflect-metadata';
import { createDataSource } from './data-source.js';
import { createTenantMigrationDataSource } from './tenant-migration-data-source.js';
import { seedSystemLedgerAccounts } from '../accounting/seed-ledger-accounts.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';

/**
 * Seeds the system chart of accounts into every live tenant schema that hasn't got the rows yet.
 * Mirrors migrate-tenants.ts: provisioning seeds a NEW tenant's schema at creation time (see
 * TenantProvisioningService), but a schema that predates the seed (e.g. provisioned before the
 * 2026-08-27 squash moved the 0059/0085/0086 ledger seeds out of migrations) needs this runner.
 *
 * Same guarded shape as migrate-tenants.ts: skip purged tenants outright, snapshot the live
 * schemas once, and — the authoritative guard — verify `current_schema()` equals the expected
 * schema right before running, so a missing/tombstoned schema can never fall through to `public`.
 */
export async function seedLedgerAccountsForAllTenants(): Promise<{
  tenantsProcessed: number;
  tenantsSkipped: string[];
}> {
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
      await seedSystemLedgerAccounts(migrationDataSource);
    } finally {
      await migrationDataSource.destroy();
    }
    processed += 1;
  }

  return { tenantsProcessed: processed, tenantsSkipped: skipped };
}

async function main(): Promise<void> {
  const { tenantsProcessed, tenantsSkipped } = await seedLedgerAccountsForAllTenants();
  console.log(
    `seed-ledger-accounts: seeded system ledger accounts across ${tenantsProcessed} tenant schema(s).`,
  );
  if (tenantsSkipped.length > 0) {
    console.log(
      `seed-ledger-accounts: skipped ${tenantsSkipped.length} tenant(s) with no live schema: ${tenantsSkipped.join(', ')}`,
    );
  }
}

if (process.argv[1]?.endsWith('seed-ledger-accounts.js') || process.argv[1]?.endsWith('seed-ledger-accounts.ts')) {
  // Explicit process.exit(0) is load-bearing: see the identical note in migrate.ts — the swc-node
  // ESM loader's worker IPC pipes keep the event loop alive after the work completes.
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
