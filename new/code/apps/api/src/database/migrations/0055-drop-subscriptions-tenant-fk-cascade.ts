import { MigrationInterface, QueryRunner } from 'typeorm';

// Purge (TenantsService.purgeTenant) hard-deletes the tenant registry row. subscriptions.tenantId
// was declared `REFERENCES tenants("hospitalId") ON DELETE CASCADE`, so every purge silently wiped
// the platform's own billing/revenue history for that tenant along with it — unlike audit_records
// (0006), which was deliberately created with no FK to tenants so it survives a purge by design.
// This drops that FK so subscriptions/subscription_invoices behave the same way: tenantId stays as
// a plain informational column, historical rows survive purge, and provisionTenant is free to
// reuse a purged hospitalId without a stale FK complicating things.
export class DropSubscriptionsTenantFkCascade1000000000055 implements MigrationInterface {
  name = 'DropSubscriptionsTenantFkCascade1000000000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS "subscriptions_tenantId_fkey"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subscriptions
       ADD CONSTRAINT "subscriptions_tenantId_fkey"
       FOREIGN KEY ("tenantId") REFERENCES tenants("hospitalId") ON DELETE CASCADE`,
    );
  }
}
