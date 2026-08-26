import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), fraction module:
 *  - P2: no reversal when the source invoice is returned or cancelled — the share entry stayed
 *    live (and payable) forever. Adds reversedAt/reversedBy to fraction_entries; the
 *    FractionReversalSubscriber marks them when an invoice is cancelled or a return created.
 *  - P2: the default-rule lookup was nondeterministic when a doctor had >1 active
 *    null-department rule. A doctor's default share is single-valued by definition, so the
 *    service guard gets a partial unique index backstop: at most one active rule per doctor
 *    where departmentId IS NULL. */
export class AddFractionReversalAndDefaultRuleUnique3000000000080 implements MigrationInterface {
  name = 'AddFractionReversalAndDefaultRuleUnique3000000000080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE fraction_entries
      ADD COLUMN "reversedAt" timestamptz NULL,
      ADD COLUMN "reversedBy" varchar NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_fraction_rules_active_default_per_doctor"
      ON fraction_rules ("doctorId")
      WHERE "departmentId" IS NULL AND "isActive" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_fraction_rules_active_default_per_doctor"`);
    await queryRunner.query(`
      ALTER TABLE fraction_entries
      DROP COLUMN "reversedAt",
      DROP COLUMN "reversedBy"
    `);
  }
}
