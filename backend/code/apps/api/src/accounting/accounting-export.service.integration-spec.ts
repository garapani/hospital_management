import ExcelJS from 'exceljs';
import { PdfService } from '@hospital/pdf';
import { ExcelService } from '@hospital/excel';
import { AccountingService } from './accounting.service.js';
import { AccountingExportService } from './accounting-export.service.js';
import { JournalNumberGeneratorService } from './journal-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

describe('AccountingExportService (integration)', () => {
  let ctx: TenantTestContext;
  let reportCtx: Awaited<ReturnType<TenantTestContext['createTenant']>>;
  let accountingService: AccountingService;
  let exportService: AccountingExportService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'accounting_export' });
    // Its own tenant, like accounting.service.integration-spec.ts's report tests — reports
    // aggregate the whole tenant, so a shared tenant would pick up other tests' journals too.
    reportCtx = await ctx.createTenant();
    accountingService = new AccountingService(
      ctx.tenantConnection,
      new JournalNumberGeneratorService(ctx.tenantConnection),
      reportCtx.tenantContext,
    );
    exportService = new AccountingExportService(accountingService, new PdfService(), new ExcelService());

    const inReport = <T>(work: () => Promise<T>): Promise<T> =>
      reportCtx.tenantContext.run({ tenantId: reportCtx.tenantId, correlationId: 'accounting-export-test' }, work);

    const makeAccount = (code: string, type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense') =>
      inReport(() => accountingService.createAccount({ accountCode: code, name: type, type }));
    const cash = await makeAccount('9100', 'Asset');
    const capital = await makeAccount('9300', 'Equity');
    const revenue = await makeAccount('9400', 'Income');
    const expense = await makeAccount('9500', 'Expense');

    const capitalJournal = await inReport(() =>
      accountingService.createJournal({
        entryDate: '2026-01-01',
        lines: [
          { accountId: cash.id, debit: 100000 },
          { accountId: capital.id, credit: 100000 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    const revenueJournal = await inReport(() =>
      accountingService.createJournal({
        entryDate: '2026-02-01',
        lines: [
          { accountId: cash.id, debit: 50000 },
          { accountId: revenue.id, credit: 50000 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    const expenseJournal = await inReport(() =>
      accountingService.createJournal({
        entryDate: '2026-02-15',
        lines: [
          { accountId: expense.id, debit: 20000 },
          { accountId: cash.id, credit: 20000 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    for (const j of [capitalJournal, revenueJournal, expenseJournal]) {
      await inReport(() => accountingService.postJournal(j.id));
    }
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const inReportRead = <T>(work: () => Promise<T>): Promise<T> =>
    reportCtx.tenantContext.run({ tenantId: reportCtx.tenantId, correlationId: 'accounting-export-test-read' }, work);

  describe('trial balance', () => {
    it('exports CSV with a header row and one row per account', async () => {
      const csv = await inReportRead(() => exportService.exportTrialBalanceCsv('2026-01-01', '2026-12-31'));
      expect(csv.split('\r\n')[0]).toBe('accountCode,accountName,accountType,debitTotal,creditTotal,balance');
      expect(csv).toContain('9100');
      expect(csv).toContain('9400');
    });

    it('exports a PDF starting with the %PDF- magic bytes', async () => {
      const buffer = await inReportRead(() => exportService.exportTrialBalancePdf('2026-01-01', '2026-12-31'));
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('exports a valid .xlsx workbook with a Trial Balance sheet', async () => {
      const buffer = await inReportRead(() => exportService.exportTrialBalanceExcel('2026-01-01', '2026-12-31'));
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.getWorksheet('Trial Balance');
      expect(sheet).toBeDefined();
      expect(sheet!.rowCount).toBeGreaterThan(1);
    });
  });

  describe('income statement', () => {
    it('exports CSV with Income and Expenses sections', async () => {
      const csv = await inReportRead(() => exportService.exportIncomeStatementCsv('2026-01-01', '2026-12-31'));
      expect(csv).toContain('Income');
      expect(csv).toContain('Expenses');
      expect(csv).toContain('9400');
      expect(csv).toContain('9500');
    });

    it('exports a PDF starting with the %PDF- magic bytes', async () => {
      const buffer = await inReportRead(() => exportService.exportIncomeStatementPdf('2026-01-01', '2026-12-31'));
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('exports a valid .xlsx workbook including the net income row', async () => {
      const buffer = await inReportRead(() => exportService.exportIncomeStatementExcel('2026-01-01', '2026-12-31'));
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.getWorksheet('Income Statement');
      expect(sheet).toBeDefined();
      const values: unknown[] = [];
      sheet!.eachRow((row) => values.push(row.getCell(3).value));
      expect(values).toContain('Net Income');
    });
  });

  describe('balance sheet', () => {
    it('exports CSV with Assets and Liabilities & Equity sections', async () => {
      const csv = await inReportRead(() => exportService.exportBalanceSheetCsv('2026-12-31'));
      expect(csv).toContain('Assets');
      expect(csv).toContain('9100');
    });

    it('exports a PDF starting with the %PDF- magic bytes', async () => {
      const buffer = await inReportRead(() => exportService.exportBalanceSheetPdf('2026-12-31'));
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('exports a valid .xlsx workbook including total rows', async () => {
      const buffer = await inReportRead(() => exportService.exportBalanceSheetExcel('2026-12-31'));
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.getWorksheet('Balance Sheet');
      expect(sheet).toBeDefined();
      const values: unknown[] = [];
      sheet!.eachRow((row) => values.push(row.getCell(3).value));
      expect(values).toContain('Total Assets');
      expect(values).toContain('Total Liabilities & Equity');
    });
  });
});
