import type { PdfDocumentDefinition } from '@hospital/pdf';
import { BalanceSheetRow, IncomeStatementRow, TrialBalanceRow } from './accounting.service.js';

const STYLES = {
  brand: { fontSize: 18, bold: true, color: '#006D77' },
  title: { fontSize: 14, bold: true, margin: [0, 4, 0, 12] as [number, number, number, number] },
  field: { fontSize: 10, margin: [0, 2, 0, 2] as [number, number, number, number] },
  section: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] as [number, number, number, number] },
  tableHeader: { bold: true, fillColor: '#E8F5F5', fontSize: 9 },
  total: { bold: true, fontSize: 9 },
};

function moneyText(amount: number): string {
  return amount.toFixed(2);
}

function periodLine(from?: string, to?: string): string {
  if (from && to) return `Period: ${from} to ${to}`;
  if (to) return `As of: ${to}`;
  if (from) return `From: ${from}`;
  return 'All time';
}

/**
 * Pure builders for the accounting reports' PDF export — no pdfmake dependency, so each is unit
 * testable without rendering. Mirrors reporting-events-pdf-document.ts's brand/title/table style
 * vocabulary, so every @hospital/pdf document in this codebase looks like one system.
 */
export function buildTrialBalancePdfDocument(rows: TrialBalanceRow[], from?: string, to?: string): PdfDocumentDefinition {
  const totalDebit = rows.reduce((sum, r) => sum + r.debitTotal, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.creditTotal, 0);
  return {
    content: [
      { text: 'VAIDYA', style: 'brand' },
      { text: 'Trial Balance', style: 'title' },
      { text: periodLine(from, to), style: 'field' },
      { text: '\n' },
      {
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
          body: [
            [
              { text: 'Code', style: 'tableHeader' },
              { text: 'Account', style: 'tableHeader' },
              { text: 'Type', style: 'tableHeader' },
              { text: 'Debit', style: 'tableHeader', alignment: 'right' },
              { text: 'Credit', style: 'tableHeader', alignment: 'right' },
              { text: 'Balance', style: 'tableHeader', alignment: 'right' },
            ],
            ...rows.map((row) => [
              { text: row.accountCode, fontSize: 9 },
              { text: row.accountName, fontSize: 9 },
              { text: row.accountType, fontSize: 9 },
              { text: moneyText(row.debitTotal), fontSize: 9, alignment: 'right' },
              { text: moneyText(row.creditTotal), fontSize: 9, alignment: 'right' },
              { text: moneyText(row.balance), fontSize: 9, alignment: 'right' },
            ]),
            [
              { text: 'Total', style: 'total', colSpan: 3 },
              {},
              {},
              { text: moneyText(totalDebit), style: 'total', alignment: 'right' },
              { text: moneyText(totalCredit), style: 'total', alignment: 'right' },
              { text: '', style: 'total' },
            ],
          ],
        },
      },
    ],
    styles: STYLES,
    defaultStyle: { fontSize: 9 },
  };
}

export function buildIncomeStatementPdfDocument(
  data: { income: IncomeStatementRow[]; expenses: IncomeStatementRow[]; netIncome: number },
  from?: string,
  to?: string,
): PdfDocumentDefinition {
  function section(title: string, rows: IncomeStatementRow[]) {
    return [
      { text: title, style: 'section' },
      {
        table: {
          widths: ['*', 'auto'],
          body: rows.map((row) => [
            { text: `${row.accountCode} — ${row.accountName}`, fontSize: 9, border: [false, false, false, true] },
            { text: moneyText(row.amount), fontSize: 9, alignment: 'right', border: [false, false, false, true] },
          ]),
        },
        layout: 'noBorders',
      },
    ];
  }

  return {
    content: [
      { text: 'VAIDYA', style: 'brand' },
      { text: 'Income Statement', style: 'title' },
      { text: periodLine(from, to), style: 'field' },
      ...section('Income', data.income),
      ...section('Expenses', data.expenses),
      {
        columns: [
          { text: 'Net Income', style: 'total' },
          { text: moneyText(data.netIncome), style: 'total', alignment: 'right' },
        ],
        margin: [0, 12, 0, 0],
      },
    ],
    styles: STYLES,
    defaultStyle: { fontSize: 9 },
  };
}

export function buildBalanceSheetPdfDocument(
  data: {
    assets: BalanceSheetRow[];
    liabilitiesAndEquity: BalanceSheetRow[];
    totalAssets: number;
    totalLiabilitiesAndEquity: number;
  },
  asOf?: string,
): PdfDocumentDefinition {
  function section(title: string, rows: BalanceSheetRow[], total: number, totalLabel: string) {
    return [
      { text: title, style: 'section' },
      {
        table: {
          widths: ['*', 'auto'],
          body: rows.map((row) => [
            { text: `${row.accountCode} — ${row.accountName}`, fontSize: 9, border: [false, false, false, true] },
            { text: moneyText(row.amount), fontSize: 9, alignment: 'right', border: [false, false, false, true] },
          ]),
        },
        layout: 'noBorders',
      },
      {
        columns: [
          { text: totalLabel, style: 'total' },
          { text: moneyText(total), style: 'total', alignment: 'right' },
        ],
        margin: [0, 4, 0, 0],
      },
    ];
  }

  return {
    content: [
      { text: 'VAIDYA', style: 'brand' },
      { text: 'Balance Sheet', style: 'title' },
      { text: periodLine(undefined, asOf), style: 'field' },
      ...section('Assets', data.assets, data.totalAssets, 'Total Assets'),
      ...section('Liabilities & Equity', data.liabilitiesAndEquity, data.totalLiabilitiesAndEquity, 'Total Liabilities & Equity'),
    ],
    styles: STYLES,
    defaultStyle: { fontSize: 9 },
  };
}
