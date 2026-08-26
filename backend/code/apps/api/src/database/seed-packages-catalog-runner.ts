import { dataSource } from './data-source.js';
import { seedPackagesCatalog } from '../packages/seed-packages-catalog.js';

async function main(): Promise<void> {
  console.log('Initializing database connection...\n');

  await dataSource.initialize();
  console.log('✓ Database connection established\n');

  try {
    console.log('Seeding packages catalog (basic/standard/enterprise)...\n');
    await seedPackagesCatalog(dataSource);
    console.log('\n✓ Packages catalog seeded successfully!\n');
  } catch (error) {
    console.error('Error during packages catalog seeding:', error);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('✓ Database connection closed\n');
  }
}

// Explicit process.exit(0) is load-bearing: see the identical note in migrate.ts — the swc-node
// ESM loader's worker IPC pipes and data-source.ts's pool-monitor setInterval keep the event loop
// alive after the work completes, so without it the command hangs despite finishing.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
