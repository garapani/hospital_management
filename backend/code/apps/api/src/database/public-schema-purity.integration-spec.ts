import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';
import { PLATFORM_MIGRATIONS } from './migrations/index.js';

/**
 * Guards the one invariant the whole multi-tenancy model depends on: the PUBLIC schema holds the
 * platform catalog and NOTHING else. Every tenant's connection runs with
 * `search_path = tenant_<id>, public`, so a tenant table landing in public is reachable through
 * that fallback — and breaks the migrate-tenants-backfill gate's "bare schema cannot load the
 * Account entity" reproduction (it stops seeing "relation does not exist" and starts seeing
 * "permission denied for table accounts" instead).
 *
 * This is an environmental guard, not a code test: the tenant baseline is only ever applied by
 * the search_path-scoped tenant migration DataSource, so a tenant migration recorded in
 * public.migrations (or a tenant table in public) means someone ran migrations against the wrong
 * connection — the 2026-08-30 incident this spec was written after (public had both baselines
 * and all ~90 tenant tables after a stray manual run during the repo restructure).
 */
describe('public schema purity (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
  }, 120000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 120000);

  it('public contains exactly the platform tables (never tenant tables)', async () => {
    const rows: { table_name: string }[] = await dataSource.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'department_catalog',
      'migrations',
      'packages',
      'permissions',
      'role_permissions',
      'roles',
      'subscription_invoices',
      'subscriptions',
      'tenant_branding',
      'tenant_roles',
      'tenants',
    ]);
  });

  it('public.migrations records only platform migrations (never tenant baselines)', async () => {
    const rows: { name: string }[] = await dataSource.query(
      `SELECT name FROM migrations ORDER BY id`,
    );
    const platformNames = PLATFORM_MIGRATIONS.map((m) => new m().name).sort();
    expect(rows.map((r) => r.name).sort()).toEqual(platformNames);
  });
});
