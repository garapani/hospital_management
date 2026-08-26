import { PLATFORM_MIGRATIONS, TENANT_MIGRATIONS } from './index.js';

/**
 * Migration ordering is carried by these arrays: TypeORM runs array-loaded migrations in ARRAY
 * order (the migrations-table history proves it — the legacy interleavings, e.g. the 2-prefix
 * tenant migrations before the 1-prefix backfills, ran exactly as the array lists them, not by
 * name suffix). The name-suffix timestamps are run-at annotations that must stay unique so any
 * tooling that does sort by them stays deterministic, and the modern block (3-prefix, where all
 * new migrations land) must stay ascending in the array.
 *
 * Two guards (code-review-findings-2026-08-25 database P3):
 *  1. every migration's sort key (trailing number of the instance `name`) is unique — a
 *     duplicate would make any suffix-based ordering ambiguous;
 *  2. the modern 3-prefix tail of each array is in ascending sort-key order — appending a new
 *     migration out of order in the tail is the failure mode that would silently run DDL before
 *     its dependencies.
 */
function migrationSortKey(migrationClass: new () => { name: string }): number {
  // The run-at sort key is the LAST 13 characters of the instance `name` (TypeORM's parse, per
  // the migration-safety-check skill) — a plain trailing-digit regex would grab extra leading
  // digits for names like AddInvoiceItemChargeUnique00492000000000049.
  const instance = new migrationClass();
  const suffix = instance.name.slice(-13);
  if (!/^\d{13}$/.test(suffix)) {
    throw new Error(`Migration ${instance.name} has no 13-digit numeric sort key`);
  }
  return Number(suffix);
}

describe('migration ordering', () => {
  it('every migration sort key is unique', () => {
    const all = [...PLATFORM_MIGRATIONS, ...TENANT_MIGRATIONS];
    const keys = all.map((m) => migrationSortKey(m));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the modern (3-prefix) block of each array is ascending in sort-key order', () => {
    for (const [label, migrations] of [
      ['PLATFORM_MIGRATIONS', PLATFORM_MIGRATIONS],
      ['TENANT_MIGRATIONS', TENANT_MIGRATIONS],
    ] as const) {
      // The 3-prefix block is where every migration since 0053 lands; legacy interleavings
      // before it are deliberate (proven-working order) and not re-checked.
      const modern = migrations.filter((m) => migrationSortKey(m) >= 3_000_000_000_000);
      const keys = modern.map((m) => migrationSortKey(m));
      for (let i = 1; i < keys.length; i += 1) {
        expect(keys[i]).toBeGreaterThan(keys[i - 1]);
      }
    }
  });
});
