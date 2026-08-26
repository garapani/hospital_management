import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P2, code-review-findings-2026-08-25.md): depreciation accrual posted
 *  nothing to the ledger. Adds the two ledger accounts the accrual journal needs (Depreciation
 *  Expense, Accumulated Depreciation), seeded per tenant like the other system accounts. */
export class AddDepreciationLedgerAccounts3000000000086 implements MigrationInterface {
  name = 'AddDepreciationLedgerAccounts3000000000086';

  private readonly accounts = [
    {
      id: '00000000-1000-4000-8000-000000000008',
      code: '5200',
      name: 'Depreciation Expense',
      type: 'Expense',
    },
    {
      id: '00000000-1000-4000-8000-000000000009',
      code: '1500',
      name: 'Accumulated Depreciation',
      type: 'Asset',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const account of this.accounts) {
      await queryRunner.query(
        `INSERT INTO ledger_accounts (id, "accountCode", name, type, "isActive", "createdBy")
         VALUES ($1, $2, $3, $4, true, 'system')
         ON CONFLICT (id) DO NOTHING`,
        [account.id, account.code, account.name, account.type],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const account of this.accounts) {
      await queryRunner.query(`DELETE FROM ledger_accounts WHERE id = $1`, [account.id]);
    }
  }
}
