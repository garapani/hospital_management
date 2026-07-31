import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantsTable implements MigrationInterface {
  name = 'CreateTenantsTable';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenants (
        "hospitalId" varchar PRIMARY KEY,
        "hospitalName" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'active',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "activatedAt" timestamptz,
        "suspendedAt" timestamptz,
        "createdBy" varchar
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenants`);
  }
}
