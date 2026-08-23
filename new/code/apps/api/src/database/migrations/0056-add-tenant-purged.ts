import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantPurged1000000000056 implements MigrationInterface {
  name = 'AddTenantPurged1000000000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants ADD "purgedAt" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN "purgedAt"`);
  }
}
