import { seedDemoData } from './seed-demo-data.js';

// Explicit process.exit(0) is load-bearing, not cosmetic — same reason as the migrate runners:
// the swc-node ESM loader keeps worker IPC pipes open and data-source.ts's pool-monitor
// setInterval (NODE_ENV != 'test') adds a permanent timer, so without an explicit exit the
// command appears to hang after the work completes.
seedDemoData()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
