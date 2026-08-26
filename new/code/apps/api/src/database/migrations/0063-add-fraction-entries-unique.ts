import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P1, code-review-findings-2026-08-25.md): recordEntry had no idempotency
 *  and no unique constraint — a double-submitted or retried request could post two fraction
 *  entries for the same invoice/doctor, paying the doctor twice with nothing to reconcile the
 *  duplicate. Backs the new application-level check with a DB constraint, matching the
 *  pre-check + constraint pattern used elsewhere in this codebase. */
export class AddFractionEntriesUnique3000000000063 implements MigrationInterface {
  name = 'AddFractionEntriesUnique3000000000063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE fraction_entries
      ADD CONSTRAINT "UQ_fraction_entries_invoice_doctor" UNIQUE ("invoiceId", "doctorId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fraction_entries DROP CONSTRAINT "UQ_fraction_entries_invoice_doctor"`);
  }
}
