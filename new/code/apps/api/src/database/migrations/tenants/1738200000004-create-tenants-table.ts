import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantsTable1738200000004 implements MigrationInterface {
  name = 'CreateTenantsTable1738200000004';

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
