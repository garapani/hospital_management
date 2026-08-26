import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), payroll module:
 *  - P2: payroll posted nothing to the ledger — marks a payslip Paid with no journal. Adds the
 *    two ledger accounts the payslip journal needs (Salary Expense, Salaries Payable), seeded
 *    per tenant like the original system accounts (migration 0059).
 *  - P2: `deductionPercent` had no upper bound and nothing stopped a negative net — adds a
 *    CHECK constraint as the DB-level backstop for the new service guard (<= 100). */
export class AddPayrollLedgerAccountsAndNetCheck3000000000085 implements MigrationInterface {
  name = 'AddPayrollLedgerAccountsAndNetCheck3000000000085';

  private readonly accounts = [
    {
      id: '00000000-1000-4000-8000-000000000006',
      code: '5100',
      name: 'Salary Expense',
      type: 'Expense',
    },
    {
      id: '00000000-1000-4000-8000-000000000007',
      code: '2200',
      name: 'Salaries Payable',
      type: 'Liability',
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
    await queryRunner.query(`
      ALTER TABLE payslips
      ADD CONSTRAINT "CHK_payslips_net_non_negative" CHECK ("netAmount" >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payslips DROP CONSTRAINT "CHK_payslips_net_non_negative"`);
    for (const account of this.accounts) {
      await queryRunner.query(`DELETE FROM ledger_accounts WHERE id = $1`, [account.id]);
    }
  }
}
