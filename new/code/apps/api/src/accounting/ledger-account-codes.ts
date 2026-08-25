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
 */
export const LEDGER_ACCOUNT_IDS = {
  PATIENT_ACCOUNTS_RECEIVABLE: '00000000-1000-4000-8000-000000000001',
  CASH_AND_BANK: '00000000-1000-4000-8000-000000000002',
  PATIENT_DEPOSITS_PAYABLE: '00000000-1000-4000-8000-000000000003',
  PATIENT_SERVICE_REVENUE: '00000000-1000-4000-8000-000000000004',
  SALES_RETURNS: '00000000-1000-4000-8000-000000000005',
} as const;
