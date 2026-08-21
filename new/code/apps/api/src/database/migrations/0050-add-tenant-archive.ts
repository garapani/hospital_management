import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantArchive1000000000050 implements MigrationInterface {
  name = 'AddTenantArchive1000000000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Soft-delete state for churned hospitals: archive keeps the schema and data intact,
    // blocks login (same tenant-status gate as suspend), and is reversible via restore.
    // IF NOT EXISTS: an earlier mis-registration (tenant-migration list) applied the column
    // against the shared DB without recording it in the platform migration table.
    await queryRunner.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS "archivedAt" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS "archivedAt"`);
  }
}
