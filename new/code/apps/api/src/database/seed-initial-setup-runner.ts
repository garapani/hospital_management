import { dataSource } from './data-source.js';
import { runInitialSetup } from './seed-initial-setup.js';

async function main(): Promise<void> {
  console.log('Initializing database connection...\n');
  
  await dataSource.initialize();
  console.log('✓ Database connection established\n');
  
  try {
    await runInitialSetup(dataSource);
  } catch (error) {
    console.error('Error during initial setup:', error);
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
