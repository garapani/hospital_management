import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the login-page copy fields (tagline/description/support/footer text) to per-tenant
 *  white-label branding — same admin-only, nullable-means-default-copy model as displayName. */
export class AddBrandingTextFields1000000000060 implements MigrationInterface {
  name = 'AddBrandingTextFields1000000000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_branding
        ADD "tagline" varchar,
        ADD "description" text,
        ADD "footerText" varchar,
        ADD "supportText" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_branding
        DROP COLUMN "tagline",
        DROP COLUMN "description",
        DROP COLUMN "footerText",
        DROP COLUMN "supportText"
    `);
  }
}
