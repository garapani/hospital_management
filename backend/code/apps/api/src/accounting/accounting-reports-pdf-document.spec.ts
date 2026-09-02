import {
  buildBalanceSheetPdfDocument,
  buildIncomeStatementPdfDocument,
  buildTrialBalancePdfDocument,
} from './accounting-reports-pdf-document.js';
import { BalanceSheetRow, IncomeStatementRow, TrialBalanceRow } from './accounting.service.js';

function contentOf(doc: { content: unknown }): unknown[] {
  return doc.content as unknown[];
}

describe('buildTrialBalancePdfDocument', () => {
  const rows: TrialBalanceRow[] = [
    { accountId: 'a1', accountCode: '1000', accountName: 'Cash', accountType: 'Asset', debitTotal: 500, creditTotal: 0, balance: 500 },
    { accountId: 'a2', accountCode: '4000', accountName: 'Revenue', accountType: 'Income', debitTotal: 0, creditTotal: 500, balance: -500 },
  ];

  it('lays out brand and title, and shows the period line', () => {
    const doc = buildTrialBalancePdfDocument(rows, '2026-01-01', '2026-01-31');
    const content = contentOf(doc);

    expect(content[0]).toEqual({ text: 'VAIDYA', style: 'brand' });
    expect(content[1]).toEqual({ text: 'Trial Balance', style: 'title' });
    expect(content[2]).toEqual({ text: 'Period: 2026-01-01 to 2026-01-31', style: 'field' });
  });

  it('falls back to "All time" when no from/to is given', () => {
    const doc = buildTrialBalancePdfDocument(rows);
    expect(contentOf(doc)[2]).toEqual({ text: 'All time', style: 'field' });
  });

  it('renders a header row, one row per account, and a total row with matching debit/credit sums', () => {
    const doc = buildTrialBalancePdfDocument(rows, '2026-01-01', '2026-01-31');
    const table = contentOf(doc).find(
      (block): block is { table: { body: unknown[][] } } => typeof block === 'object' && block !== null && 'table' in block,
    );

    expect(table).toBeDefined();
    expect(table!.table.body).toHaveLength(4); // header + 2 accounts + total
    expect(table!.table.body[0][0]).toEqual({ text: 'Code', style: 'tableHeader' });
    expect(table!.table.body[1][0]).toEqual({ text: '1000', fontSize: 9 });
    const totalRow = table!.table.body[3];
    expect(totalRow[0]).toEqual({ text: 'Total', style: 'total', colSpan: 3 });
    expect(totalRow[3]).toEqual({ text: '500.00', style: 'total', alignment: 'right' });
    expect(totalRow[4]).toEqual({ text: '500.00', style: 'total', alignment: 'right' });
  });
});

describe('buildIncomeStatementPdfDocument', () => {
  const income: IncomeStatementRow[] = [{ accountCode: '4000', accountName: 'Revenue', amount: 1000 }];
  const expenses: IncomeStatementRow[] = [{ accountCode: '5000', accountName: 'Salaries', amount: 400 }];

  it('lays out brand, title, an Income section, an Expenses section, and the net income line', () => {
    const doc = buildIncomeStatementPdfDocument({ income, expenses, netIncome: 600 }, '2026-01-01', '2026-01-31');
    const content = contentOf(doc);

    expect(content[0]).toEqual({ text: 'VAIDYA', style: 'brand' });
    expect(content[1]).toEqual({ text: 'Income Statement', style: 'title' });
    expect(content).toContainEqual({ text: 'Income', style: 'section' });
    expect(content).toContainEqual({ text: 'Expenses', style: 'section' });
    const netIncomeBlock = content.find(
      (block): block is { columns: unknown[] } => typeof block === 'object' && block !== null && 'columns' in block,
    );
    expect(netIncomeBlock).toBeDefined();
    expect(netIncomeBlock!.columns).toEqual([
      { text: 'Net Income', style: 'total' },
      { text: '600.00', style: 'total', alignment: 'right' },
    ]);
  });
});

describe('buildBalanceSheetPdfDocument', () => {
  const assets: BalanceSheetRow[] = [{ accountCode: '1000', accountName: 'Cash', accountType: 'Asset', amount: 1000 }];
  const liabilitiesAndEquity: BalanceSheetRow[] = [
    { accountCode: '2000', accountName: 'Payables', accountType: 'Liability', amount: 400 },
  ];

  it('lays out brand, title, an Assets section, and a Liabilities & Equity section', () => {
    const doc = buildBalanceSheetPdfDocument(
      { assets, liabilitiesAndEquity, totalAssets: 1000, totalLiabilitiesAndEquity: 400 },
      '2026-01-31',
    );
    const content = contentOf(doc);

    expect(content[0]).toEqual({ text: 'VAIDYA', style: 'brand' });
    expect(content[1]).toEqual({ text: 'Balance Sheet', style: 'title' });
    expect(content[2]).toEqual({ text: 'As of: 2026-01-31', style: 'field' });
    expect(content).toContainEqual({ text: 'Assets', style: 'section' });
    expect(content).toContainEqual({ text: 'Liabilities & Equity', style: 'section' });
  });
});
