import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): `ledger_accounts.accountCode`
 *  had no UNIQUE constraint — two accounts could silently share a code (same shape as the
 *  lab_tests fix, migration 0074). */
export class AddLedgerAccountsCodeUnique3000000000082 implements MigrationInterface {
  name = 'AddLedgerAccountsCodeUnique3000000000082';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ledger_accounts ADD CONSTRAINT "UQ_ledger_accounts_accountCode" UNIQUE ("accountCode")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ledger_accounts DROP CONSTRAINT "UQ_ledger_accounts_accountCode"`);
  }
}
