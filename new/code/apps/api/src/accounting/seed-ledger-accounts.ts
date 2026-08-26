import { LEDGER_ACCOUNTS } from './ledger-account-codes.js';

/**
 * Idempotent, upsert-based seeder for the system chart of accounts — one row per tenant schema.
 * This is where the fixed accounts that automatic billing->accounting posting resolves by id
 * (see ledger-account-codes.ts) come from, replacing the seeds that used to live in migrations
 * 0059/0085/0086 (Development-Standards.md §108).
 *
 * The `runner` must be scoped to the target tenant schema — either the tenant migration DataSource
 * (whose `-c search_path=<schema>,public` connection option makes the unqualified INSERTs land in
 * the tenant schema; this is how TenantProvisioningService invokes it) or an EntityManager inside
 * TenantConnectionService.runInTenantSchema.
 *
 * createdBy is 'system': these rows are not attributable to an authenticated principal.
 */
export async function seedSystemLedgerAccounts(runner: {
  query: (sql: string, parameters?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  for (const account of LEDGER_ACCOUNTS) {
    await runner.query(
      `INSERT INTO ledger_accounts (id, "accountCode", name, type, "isActive", "createdBy")
       VALUES ($1, $2, $3, $4, true, 'system')
       ON CONFLICT (id) DO NOTHING`,
      [account.id, account.accountCode, account.name, account.type],
    );
  }
}
