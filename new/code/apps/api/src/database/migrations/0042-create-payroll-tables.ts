import { MigrationInterface, QueryRunner } from 'typeorm';

/** Payroll module (PRD Phase 5): monthly payslips computed from the employee master. */
export class CreatePayrollTables0042 implements MigrationInterface {
  name = 'CreatePayrollTables00422000000000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payslips (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL,
        "periodMonth" int NOT NULL,
        "periodYear" int NOT NULL,
        "basicAmount" numeric(12,2) NOT NULL,
        "allowanceAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "grossAmount" numeric(12,2) NOT NULL,
        "deductionAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "netAmount" numeric(12,2) NOT NULL,
        status varchar NOT NULL DEFAULT 'Draft',
        "processedBy" uuid NOT NULL,
        "paidAt" timestamptz NULL,
        notes text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("employeeId", "periodMonth", "periodYear")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE payslips`);
  }
}
