import { MigrationInterface, QueryRunner } from 'typeorm';

/** Employee module (PRD Phase 5): HR employee master. */
export class CreateEmployeeTables0041 implements MigrationInterface {
  name = 'CreateEmployeeTables00412000000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE employees (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeCode" varchar NOT NULL UNIQUE,
        "firstName" varchar NOT NULL,
        "lastName" varchar NOT NULL,
        "departmentId" uuid NULL,
        designation varchar NULL,
        phone varchar NULL,
        email varchar NULL,
        "joinDate" date NOT NULL,
        "employmentType" varchar NOT NULL DEFAULT 'FullTime',
        "monthlyBasicSalary" numeric(12,2) NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE employee_sequences (
        prefix varchar NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE employee_sequences`);
    await queryRunner.query(`DROP TABLE employees`);
  }
}
