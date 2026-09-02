import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes an over-grant carried over from the raw `pg_dump` squash: migration 0093's baseline runs
 * `REVOKE USAGE ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO PUBLIC;` back to back —
 * the second statement immediately undoes the first and goes further, since schema-level `ALL`
 * means `USAGE` **and** `CREATE`. Every tenant Postgres role (`tenant_<hospitalId>`) is `PUBLIC`
 * for this purpose, so today every tenant role can `CREATE TABLE`/`CREATE FUNCTION` directly in
 * the shared `public` schema — schema pollution / a foothold for a future exploit, even though
 * `TenantProvisioningService` never grants any *table-level* DML on `public` tables to a tenant
 * role (that part was already correctly scoped; this migration closes the schema-level gap).
 *
 * `PUBLIC` is a pseudo-role covering every role, current and future, so a single
 * `REVOKE`/`GRANT ... TO/FROM PUBLIC` on the schema itself is enough — no per-tenant-role backfill
 * loop needed, unlike a tenant-scoped table migration. `USAGE` is kept (not fully revoked): tenant
 * queries rely on `SET LOCAL search_path TO "<tenant_schema>", public` resolving `gen_random_uuid()`
 * (installed into `public` by `CREATE EXTENSION pgcrypto` in 0093) as a column default on every
 * `id uuid DEFAULT gen_random_uuid()` — revoking `USAGE` too would break every tenant-schema INSERT.
 * Found in the 2026-09-03 external review; see pending-tasks.md Phase 1.
 */
export class RestrictPublicSchemaGrants4000000000001 implements MigrationInterface {
  name = 'RestrictPublicSchemaGrants4000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO PUBLIC`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`GRANT ALL ON SCHEMA public TO PUBLIC`);
  }
}
