import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the fixed chart-of-accounts entries that automatic billing-to-accounting posting
 * (InvoicesService.recordPayment/createReturn, DepositsService.create/refund, charge-capture
 * revenue) resolves by id — see apps/api/src/accounting/ledger-account-codes.ts for the mapping
 * and the ids themselves (kept in sync with the literals below; migrations stay self-contained and
 * don't import application code). createdBy is 'system': these rows are not attributable to an
 * authenticated principal.
 */
export class SeedDefaultLedgerAccounts3000000000059 implements MigrationInterface {
  // Sort key intentionally 3xxx, after every existing migration (including 0058 above) — see the
  // migration-safety-check skill on why array position doesn't determine actual run order.
  name = 'SeedDefaultLedgerAccounts3000000000059';

  private readonly accounts = [
    { id: '00000000-1000-4000-8000-000000000001', code: '1000', name: 'Patient Accounts Receivable', type: 'Asset' },
    { id: '00000000-1000-4000-8000-000000000002', code: '1010', name: 'Cash and Bank', type: 'Asset' },
    { id: '00000000-1000-4000-8000-000000000003', code: '2000', name: 'Patient Deposits Payable', type: 'Liability' },
    { id: '00000000-1000-4000-8000-000000000004', code: '4000', name: 'Patient Service Revenue', type: 'Income' },
    { id: '00000000-1000-4000-8000-000000000005', code: '4900', name: 'Sales Returns', type: 'Income' },
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
    await queryRunner.query(
      `DELETE FROM ledger_accounts WHERE id = ANY($1::uuid[])`,
      [this.accounts.map((a) => a.id)],
    );
  }
}
