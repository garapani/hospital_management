import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), cssd module:
 *  - P2: `cssd_instruments.code` had no UNIQUE constraint — two instruments could silently
 *    share a code (same shape as the lab_tests fix, migration 0074).
 *  - P2: nothing prevented concurrent InProgress cycles for the same instrument — the service
 *    pre-check gets a partial unique index backstop, mirroring the admissions/ot patterns.
 *  - P2: no index on the cycles table's `instrumentId` despite it being the list filter
 *    (plus `status`, the other listCycles filter). */
export class AddCssdCodeUniqueAndCycleConstraints3000000000078 implements MigrationInterface {
  name = 'AddCssdCodeUniqueAndCycleConstraints3000000000078';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cssd_instruments ADD CONSTRAINT "UQ_cssd_instruments_code" UNIQUE (code)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cssd_sterilization_cycles_active_instrument"
      ON cssd_sterilization_cycles ("instrumentId")
      WHERE status = 'InProgress'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cssd_sterilization_cycles_instrument_id"
      ON cssd_sterilization_cycles ("instrumentId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cssd_sterilization_cycles_status"
      ON cssd_sterilization_cycles (status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_cssd_sterilization_cycles_status"`);
    await queryRunner.query(`DROP INDEX "IDX_cssd_sterilization_cycles_instrument_id"`);
    await queryRunner.query(`DROP INDEX "UQ_cssd_sterilization_cycles_active_instrument"`);
    await queryRunner.query(`ALTER TABLE cssd_instruments DROP CONSTRAINT "UQ_cssd_instruments_code"`);
  }
}
