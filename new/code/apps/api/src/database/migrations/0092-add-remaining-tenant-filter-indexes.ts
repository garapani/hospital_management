import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): secondary indexes missing on
 *  newer tenant tables. audit_records (0090), helpdesk_tickets (0088), and notifications (0087)
 *  were covered by their own module batches; this closes employees (list filter departmentId /
 *  employmentType) and patient_referrals (list filters patientId / sourceId). */
export class AddRemainingTenantFilterIndexes3000000000092 implements MigrationInterface {
  name = 'AddRemainingTenantFilterIndexes3000000000092';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_employees_department_id" ON employees ("departmentId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_employees_employment_type" ON employees ("employmentType")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_patient_referrals_patient_id" ON patient_referrals ("patientId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_patient_referrals_source_id" ON patient_referrals ("sourceId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_patient_referrals_source_id"`);
    await queryRunner.query(`DROP INDEX "IDX_patient_referrals_patient_id"`);
    await queryRunner.query(`DROP INDEX "IDX_employees_employment_type"`);
    await queryRunner.query(`DROP INDEX "IDX_employees_department_id"`);
  }
}
