import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SaaS packages: the tiering chosen at tenant creation. `packages` is a public-schema catalog
 * table (like roles/permissions); `tenants.packageCode` records each tenant's tier.
 *
 * Package gating is resolution-time: a tenant's JWTs only carry permissions whose modules are in
 * its package (PackagesService.filterPermissions at login/refresh). No data is hidden or
 * partitioned — schema stays uniform, access is just granted/revoked.
 *
 * Existing tenants (incl. the demo) are grandfathered onto Enterprise: they were provisioned
 * before packages existed with the full permission set, and stripping access now would silently
 * break their running consoles. New tenants default to 'basic' (the MVP launch tier).
 */
export class CreatePackagesTable0048 implements MigrationInterface {
  name = 'CreatePackagesTable1000000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE packages (
        code varchar PRIMARY KEY,
        name varchar NOT NULL,
        description text,
        modules jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO packages (code, name, description, modules) VALUES
        ('basic', 'Basic',
         'Small hospitals: registration, visits, billing, lab, radiology, pharmacy, inventory, employees, payroll and core reporting.',
         '["patients","appointments","admissions","billing","orders","clinical","lab","radiology","pharmacy","inventory","employee","payroll","notifications","reporting"]'::jsonb),
        ('standard', 'Standard',
         'Medium hospitals: Basic plus ward supply, nursing, OT, maternity, CSSD, vaccination, fixed assets, helpdesk, marketing, SSU and doctor fraction.',
         '["patients","appointments","admissions","billing","orders","clinical","lab","radiology","pharmacy","inventory","employee","payroll","notifications","reporting","ward-supply","nursing","ot","maternity","cssd","vaccination","fixed-assets","helpdesk","marketing","ssu","fraction"]'::jsonb),
        ('enterprise', 'Enterprise',
         'Large hospitals: Standard plus insurance & claims, accounting, and the full Document & Print scope.',
         '["patients","appointments","admissions","billing","orders","clinical","lab","radiology","pharmacy","inventory","employee","payroll","notifications","reporting","ward-supply","nursing","ot","maternity","cssd","vaccination","fixed-assets","helpdesk","marketing","ssu","fraction","insurance","accounting","document-print"]'::jsonb)
      ON CONFLICT (code) DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN "packageCode" varchar NOT NULL DEFAULT 'basic' REFERENCES packages(code)
    `);

    await queryRunner.query(`UPDATE tenants SET "packageCode" = 'enterprise'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN "packageCode"`);
    await queryRunner.query(`DROP TABLE packages`);
  }
}
