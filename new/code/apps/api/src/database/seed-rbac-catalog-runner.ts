import { dataSource } from './data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';

async function main(): Promise<void> {
  console.log('Initializing database connection...\n');
  
  await dataSource.initialize();
  console.log('✓ Database connection established\n');
  
  try {
    console.log('Seeding RBAC catalog (roles, permissions, and role-permission mappings)...\n');
    await seedRbacCatalog(dataSource);
    console.log('\n✓ RBAC catalog seeded successfully!\n');
  } catch (error) {
    console.error('Error during RBAC seeding:', error);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('✓ Database connection closed\n');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
