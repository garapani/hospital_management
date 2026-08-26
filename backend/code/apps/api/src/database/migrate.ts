import { dataSource } from './data-source.js';

async function main(): Promise<void> {
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}

// Explicit process.exit(0) is load-bearing, not cosmetic: this script runs under the swc-node ESM
// loader (nx api:migrate target), whose worker IPC pipes keep the event loop alive after main()
// finishes — without an explicit exit the command appears to hang forever even though all
// migrations applied. (The old pool-monitor setInterval that also kept it alive was removed —
// see data-source.ts, database P2.)
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
