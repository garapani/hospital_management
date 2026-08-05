import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRadiologyRequisitionReportChecks0021 implements MigrationInterface {
  name = 'AddRadiologyRequisitionReportChecks00212000000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE radiology_requisitions
      ADD CONSTRAINT "CHK_radiology_requisitions_report_entered_complete"
      CHECK (
        status NOT IN ('ReportEntered', 'Verified')
        OR ("reportText" IS NOT NULL AND "reportEnteredBy" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE radiology_requisitions
      ADD CONSTRAINT "CHK_radiology_requisitions_verified_complete"
      CHECK (
        status <> 'Verified'
        OR ("verifiedBy" IS NOT NULL AND "verifiedAt" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE radiology_requisitions
      ADD CONSTRAINT "CHK_radiology_requisitions_scanned_complete"
      CHECK (
        status NOT IN ('Scanned', 'ReportEntered', 'Verified')
        OR ("scannedBy" IS NOT NULL AND "scannedAt" IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE radiology_requisitions DROP CONSTRAINT "CHK_radiology_requisitions_scanned_complete"`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions DROP CONSTRAINT "CHK_radiology_requisitions_verified_complete"`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions DROP CONSTRAINT "CHK_radiology_requisitions_report_entered_complete"`);
  }
}
