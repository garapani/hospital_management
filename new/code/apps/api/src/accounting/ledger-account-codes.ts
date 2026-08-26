/**
 * Fixed ledger account ids seeded by migration 0059 (SeedDefaultLedgerAccounts) — one row per
 * tenant schema. Billing hooks reference these ids directly (not by accountCode lookup) so a
 * duplicate/renamed accountCode created later via the accounting API can never cause an auto-post
 * to silently resolve the wrong account: the id is the only source of truth.
 *
 * Mapping (see Development-Standards.md "Automatic ledger posting from Billing" section):
 * - PATIENT_ACCOUNTS_RECEIVABLE: Asset — debited at charge-capture (revenue recognized), credited
 *   when a payment/deposit-liability settles it or a return contra-reverses it.
 * - CASH_AND_BANK: Asset — covers Cash/Card/UPI/Cheque payment modes; no per-mode sub-accounts.
 * - PATIENT_DEPOSITS_PAYABLE: Liability — credited when a deposit is received, debited when a
 *   deposit funds a payment or is refunded.
 * - PATIENT_SERVICE_REVENUE: Income — credited at charge-capture (order item completion).
 * - SALES_RETURNS: Income (contra — carries a debit-normal balance), debited on a return/credit
 *   note against Patient AR.
 * - SALARY_EXPENSE: Expense — debited when a payslip is marked Paid (payroll, migration 0085).
 * - SALARIES_PAYABLE: Liability — credited when a payslip is marked Paid (payroll, migration 0085).
 * - DEPRECIATION_EXPENSE: Expense — debited when depreciation accrues (fixed-assets, migration 0086).
 * - ACCUMULATED_DEPRECIATION: Asset (contra — carries a credit-normal balance), credited when
 *   depreciation accrues (fixed-assets, migration 0086).
 */
export const LEDGER_ACCOUNT_IDS = {
  PATIENT_ACCOUNTS_RECEIVABLE: '00000000-1000-4000-8000-000000000001',
  CASH_AND_BANK: '00000000-1000-4000-8000-000000000002',
  PATIENT_DEPOSITS_PAYABLE: '00000000-1000-4000-8000-000000000003',
  PATIENT_SERVICE_REVENUE: '00000000-1000-4000-8000-000000000004',
  SALES_RETURNS: '00000000-1000-4000-8000-000000000005',
  SALARY_EXPENSE: '00000000-1000-4000-8000-000000000006',
  SALARIES_PAYABLE: '00000000-1000-4000-8000-000000000007',
  DEPRECIATION_EXPENSE: '00000000-1000-4000-8000-000000000008',
  ACCUMULATED_DEPRECIATION: '00000000-1000-4000-8000-000000000009',
} as const;

export interface SystemLedgerAccount {
  id: string;
  accountCode: string;
  name: string;
  type: 'Asset' | 'Liability' | 'Income' | 'Expense';
}

/**
 * The full system chart-of-accounts: one row per tenant schema, seeded by
 * seedSystemLedgerAccounts() (accounting/seed-ledger-accounts.ts) at tenant provisioning time and
 * by the `seed-ledger-accounts` runner for already-provisioned schemas. This array is the single
 * source of truth — it replaced the literals that migrations 0059/0085/0086 used to carry (the
 * old "kept in sync with the literals below" hazard, Development-Standards.md §108).
 */
export const LEDGER_ACCOUNTS: readonly SystemLedgerAccount[] = [
  { id: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, accountCode: '1000', name: 'Patient Accounts Receivable', type: 'Asset' },
  { id: LEDGER_ACCOUNT_IDS.CASH_AND_BANK, accountCode: '1010', name: 'Cash and Bank', type: 'Asset' },
  { id: LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE, accountCode: '2000', name: 'Patient Deposits Payable', type: 'Liability' },
  { id: LEDGER_ACCOUNT_IDS.PATIENT_SERVICE_REVENUE, accountCode: '4000', name: 'Patient Service Revenue', type: 'Income' },
  { id: LEDGER_ACCOUNT_IDS.SALES_RETURNS, accountCode: '4900', name: 'Sales Returns', type: 'Income' },
  { id: LEDGER_ACCOUNT_IDS.SALARY_EXPENSE, accountCode: '5100', name: 'Salary Expense', type: 'Expense' },
  { id: LEDGER_ACCOUNT_IDS.SALARIES_PAYABLE, accountCode: '2200', name: 'Salaries Payable', type: 'Liability' },
  { id: LEDGER_ACCOUNT_IDS.DEPRECIATION_EXPENSE, accountCode: '5200', name: 'Depreciation Expense', type: 'Expense' },
  { id: LEDGER_ACCOUNT_IDS.ACCUMULATED_DEPRECIATION, accountCode: '1500', name: 'Accumulated Depreciation', type: 'Asset' },
];
