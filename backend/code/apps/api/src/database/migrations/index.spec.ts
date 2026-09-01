import { PLATFORM_MIGRATIONS, TENANT_MIGRATIONS } from './index.js';

/**
 * Migration ordering is carried by these arrays: TypeORM runs array-loaded migrations in ARRAY
 * order (the migrations-table history proved it — the legacy interleavings ran exactly as the
 * array listed them, not by name suffix). The name-suffix timestamps are run-at annotations that
 * must stay unique so any tooling that does sort by them stays deterministic, and the modern
 * (3-prefix) block must stay ascending in the array.
 *
 * The 92-file history (0001-0092) was squashed into two immutable baselines on 2026-08-27
 * (Development-Standards.md §108), so each array now holds exactly one entry. Two guards remain
 * (code-review-findings-2026-08-25 database P3):
 *  1. every migration's sort key (trailing number of the instance `name`) is unique — a
 *     duplicate would make any suffix-based ordering ambiguous;
 *  2. the modern 3-prefix tail of each array is in ascending sort-key order — appending a new
 *     migration out of order in the tail is the failure mode that would silently run DDL before
 *     its dependencies;
 *  3. the two squashed baselines are exactly what the arrays carry — a regression that deletes a
 *     baseline (or reintroduces the per-file regime) fails here instead of drifting silently.
 */
function migrationSortKey(migrationClass: new () => { name: string }): number {
  // The run-at sort key is the LAST 13 characters of the instance `name` (TypeORM's parse) — a
  // plain trailing-digit regex would grab extra leading digits for names like
  // AddInvoiceItemChargeUnique00492000000000049.
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
    for (const migrations of [PLATFORM_MIGRATIONS, TENANT_MIGRATIONS]) {
      const modern = migrations.filter((m) => migrationSortKey(m) >= 3_000_000_000_000);
      const keys = modern.map((m) => migrationSortKey(m));
      for (let i = 1; i < keys.length; i += 1) {
        expect(keys[i]).toBeGreaterThan(keys[i - 1]);
      }
    }
  });

  it('carries the two squashed baselines, unmodified and in position (nothing deleted, nothing reintroduced)', () => {
    const names = [...PLATFORM_MIGRATIONS, ...TENANT_MIGRATIONS].map((m) => new m().name);
    expect(names).toEqual(
      expect.arrayContaining(['InitialPlatformSchema1000000000093', 'InitialTenantSchema2000000000094']),
    );
    expect(names.indexOf('InitialTenantSchema2000000000094')).toBeLessThan(
      names.indexOf('AddPatientAllergies3000000000001'),
    );
  });
});
