import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMasterDataTables implements MigrationInterface {
  name = 'CreateMasterDataTables2000000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "departmentCode" varchar NOT NULL UNIQUE,
        "departmentName" varchar NOT NULL,
        description varchar NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "isAppointmentApplicable" boolean NOT NULL DEFAULT false,
        "parentDepartmentId" uuid NULL REFERENCES departments(id),
        "roomNumber" varchar NULL,
        "noticeText" varchar NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE wards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "wardCode" varchar NOT NULL UNIQUE,
        "wardName" varchar NOT NULL,
        "wardType" varchar NULL,
        "bedCapacity" integer NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE wards`);
    await queryRunner.query(`DROP TABLE departments`);
  }
}
