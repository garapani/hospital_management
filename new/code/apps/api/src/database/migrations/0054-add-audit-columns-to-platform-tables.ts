import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Standard audit columns (createdBy, updatedBy, deletedAt, deletedBy) across every in-scope
 * platform-scoped (public-schema) table — see
 * new/docs/superpowers/specs/2026-08-22-entity-audit-columns-design.md. `tenants` is
 * deliberately excluded (see that doc's §2): its createdBy is a free-text actor field, not a
 * uuid, and it already has its own archivedAt lifecycle column. `roles`/`permissions` had no
 * createdAt/updatedAt at all (added below); `department_catalog`/`packages`/`subscriptions` had
 * createdAt but never updatedAt (added below); `subscription_invoices` had neither (its own
 * `issuedAt` stays, this adds the standard createdAt alongside it) — verified against each
 * table's original CREATE TABLE migration, not assumed from the entity class. All new columns
 * nullable, IF NOT EXISTS for idempotency, matching 0053's tenant-scoped counterpart.
 */
export class AddAuditColumnsToPlatformTables1000000000054 implements MigrationInterface {
  name = 'AddAuditColumnsToPlatformTables1000000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['roles', 'permissions', 'subscription_invoices']) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT now()`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now()`,
      );
    }
    for (const table of ['department_catalog', 'packages', 'subscriptions']) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now()`,
      );
    }

    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE permissions ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE permissions ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE permissions ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE permissions ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE department_catalog ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE department_catalog ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE department_catalog ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE department_catalog ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE tenant_branding ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE tenant_branding ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE tenant_branding ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE tenant_branding ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE permissions DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE permissions DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE permissions DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE permissions DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE department_catalog DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE department_catalog DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE department_catalog DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE department_catalog DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE packages DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE packages DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE packages DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE packages DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE subscription_invoices DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE subscription_invoices DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE subscription_invoices DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE subscription_invoices DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE tenant_branding DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE tenant_branding DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE tenant_branding DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE tenant_branding DROP COLUMN IF EXISTS "createdBy"`);

    for (const table of ['department_catalog', 'packages', 'subscriptions']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "updatedAt"`);
    }
    for (const table of ['roles', 'permissions', 'subscription_invoices']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "updatedAt"`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "createdAt"`);
    }
  }
}
