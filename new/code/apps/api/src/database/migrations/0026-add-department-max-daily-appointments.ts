import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartmentMaxDailyAppointments0026 implements MigrationInterface {
  name = 'AddDepartmentMaxDailyAppointments00262000000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE departments ADD COLUMN "maxDailyAppointments" integer NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE departments DROP COLUMN "maxDailyAppointments"`);
  }
}
